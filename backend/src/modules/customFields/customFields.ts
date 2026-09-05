import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { teacherSectionIds } from '../../lib/teacherScope';
import {
  createCustomFieldDefinitionSchema,
  updateCustomFieldDefinitionSchema,
  putStudentCustomFieldValuesSchema,
} from './validation';

/**
 * The merged "definition + this student's current answer" view used by
 * both GET and PUT of a student's values — every active field gets a row
 * even if unanswered, plus any inactive field the student already has an
 * answer for (so a retired field's old answer stays visible/history is
 * kept, matching the CustomFieldDefinition `active` doc-comment).
 */
async function studentCustomFieldValueRows(tx: Prisma.TransactionClient, studentId: string) {
  const [definitions, values] = await Promise.all([
    tx.customFieldDefinition.findMany({
      where: { OR: [{ active: true }, { values: { some: { studentId } } }] },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    tx.studentCustomFieldValue.findMany({ where: { studentId } }),
  ]);

  const valueByFieldId = new Map(values.map((v) => [v.fieldDefinitionId, v]));
  return definitions.map((def) => {
    const existing = valueByFieldId.get(def.id);
    return {
      fieldDefinitionId: def.id,
      label: def.label,
      fieldType: def.fieldType,
      options: def.options,
      required: def.required,
      active: def.active,
      value: existing?.value ?? null,
      updatedAt: existing?.updatedAt ?? null,
    };
  });
}

export const customFieldsRouter = Router();
customFieldsRouter.use(requireAuth);

// Anyone who can already see/edit a student record can see what the extra
// fields *are* (labels/types) — the same broad set as students.ts's
// READ_ROLES. Only SCHOOL_ADMIN can add/edit/retire a field definition
// itself, since that's a schema-config action, same tier as Settings.
const DEFINITION_READ_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK', 'TEACHER', 'ACCOUNTANT'] as const;
const DEFINITION_WRITE_ROLES = ['SCHOOL_ADMIN'] as const;
// Values follow students.ts's own read/write tiers exactly, including
// TEACHER being read-only and section-scoped.
const VALUE_READ_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK', 'TEACHER', 'ACCOUNTANT'] as const;
const VALUE_WRITE_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK'] as const;

// ────────────────────────────────────────────────────────────────
// Field definitions
// ────────────────────────────────────────────────────────────────

customFieldsRouter.get('/', requireRole(...DEFINITION_READ_ROLES), async (req: Request, res: Response) => {
  const auth = req.auth!;
  // The manage-fields admin page needs to see disabled fields too (to
  // re-enable or confirm they're retired); every other consumer (the
  // student form) only wants the currently-active list.
  const includeInactive = req.query.includeInactive === 'true' && auth.role === 'SCHOOL_ADMIN';

  const definitions = await runWithTenant(auth.tenantId, (tx) =>
    tx.customFieldDefinition.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
  );

  res.json({ data: definitions });
});

customFieldsRouter.post('/', requireRole(...DEFINITION_WRITE_ROLES), async (req: Request, res: Response) => {
  const input = createCustomFieldDefinitionSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;

  const existing = await runWithTenant(tenantId, (tx) =>
    tx.customFieldDefinition.findFirst({ where: { label: input.label } }),
  );
  if (existing) throw AppError.conflict('A field with this label already exists');

  const created = await runWithTenant(tenantId, (tx) =>
    tx.customFieldDefinition.create({
      data: {
        id: randomUUID(),
        tenantId,
        label: input.label,
        fieldType: input.fieldType,
        options: input.fieldType === 'SELECT' ? input.options : undefined,
        required: input.required ?? false,
        sortOrder: input.sortOrder ?? 0,
      },
    }),
  );

  res.status(201).json({ data: created });
});

customFieldsRouter.patch('/:id', requireRole(...DEFINITION_WRITE_ROLES), async (req: Request, res: Response) => {
  const input = updateCustomFieldDefinitionSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  const id = uuidParam(req, 'id');

  const updated = await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.customFieldDefinition.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Custom field not found');

    if (input.label && input.label !== existing.label) {
      const clash = await tx.customFieldDefinition.findFirst({ where: { label: input.label, id: { not: id } } });
      if (clash) throw AppError.conflict('A field with this label already exists');
    }

    // A SELECT field's options may only be edited, never removed down to
    // zero — existing student answers may reference an option that must
    // stay selectable/visible even if the school stops offering it going
    // forward (they should add a new option, not delete the old one, if
    // students still hold that value — same "don't destroy history" spirit
    // as the active flag).
    if (existing.fieldType === 'SELECT' && input.options && input.options.length === 0) {
      throw AppError.badRequest('A Dropdown field needs at least one option');
    }

    return tx.customFieldDefinition.update({
      where: { id },
      data: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.options !== undefined ? { options: input.options } : {}),
        ...(input.required !== undefined ? { required: input.required } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
    });
  });

  res.json({ data: updated });
});

customFieldsRouter.delete('/:id', requireRole(...DEFINITION_WRITE_ROLES), async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId!;
  const id = uuidParam(req, 'id');

  await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.customFieldDefinition.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Custom field not found');

    // Hard-delete only if no student has ever answered this field —
    // otherwise a deletion would silently cascade-delete every student's
    // stored answer. A field that's in use should be retired via `active:
    // false` instead, which keeps the values (and their history) intact.
    const valueCount = await tx.studentCustomFieldValue.count({ where: { fieldDefinitionId: id } });
    if (valueCount > 0) {
      throw AppError.conflict(
        'This field already has values recorded against students — disable it instead of deleting it',
      );
    }

    await tx.customFieldDefinition.delete({ where: { id } });
  });

  res.status(204).send();
});

// ────────────────────────────────────────────────────────────────
// Per-student values
// ────────────────────────────────────────────────────────────────

customFieldsRouter.get(
  '/students/:studentId/values',
  requireRole(...VALUE_READ_ROLES),
  async (req: Request, res: Response) => {
    const auth = req.auth!;
    const studentId = uuidParam(req, 'studentId');

    const rows = await runWithTenant(auth.tenantId, async (tx) => {
      const student = await tx.student.findUnique({ where: { id: studentId }, select: { currentSectionId: true } });
      if (!student) throw AppError.notFound('Student not found');
      if (auth.role === 'TEACHER') {
        const allowed = await teacherSectionIds(tx, auth.userId);
        if (!student.currentSectionId || !allowed.includes(student.currentSectionId)) {
          throw AppError.forbidden('You do not have access to this student');
        }
      }

      return studentCustomFieldValueRows(tx, studentId);
    });

    res.json({ data: rows });
  },
);

customFieldsRouter.put(
  '/students/:studentId/values',
  requireRole(...VALUE_WRITE_ROLES),
  async (req: Request, res: Response) => {
    const input = putStudentCustomFieldValuesSchema.parse(req.body);
    const tenantId = req.auth!.tenantId!;
    const auth = req.auth!;
    const studentId = uuidParam(req, 'studentId');

    await runWithTenant(tenantId, async (tx) => {
      const student = await tx.student.findUnique({ where: { id: studentId } });
      if (!student) throw AppError.badRequest('Unknown studentId');

      const fieldIds = input.values.map((v) => v.fieldDefinitionId);
      const definitions = await tx.customFieldDefinition.findMany({ where: { id: { in: fieldIds } } });
      const definitionById = new Map(definitions.map((d) => [d.id, d]));

      for (const item of input.values) {
        const def = definitionById.get(item.fieldDefinitionId);
        if (!def) throw AppError.badRequest(`Unknown fieldDefinitionId: ${item.fieldDefinitionId}`);

        // An empty string clears the value entirely rather than storing
        // "" — a blank answer and "no answer yet" should look the same.
        if (item.value.trim() === '') {
          await tx.studentCustomFieldValue.deleteMany({ where: { studentId, fieldDefinitionId: def.id } });
          continue;
        }

        // Basic per-type sanity check so obviously-wrong data (e.g. text
        // typed into a NUMBER field) doesn't get stored silently — kept
        // light since the frontend form is the primary guard.
        if (def.fieldType === 'NUMBER' && Number.isNaN(Number(item.value))) {
          throw AppError.badRequest(`"${def.label}" expects a number`);
        }
        if (def.fieldType === 'BOOLEAN' && item.value !== 'true' && item.value !== 'false') {
          throw AppError.badRequest(`"${def.label}" expects true or false`);
        }
        if (def.fieldType === 'SELECT') {
          const options = Array.isArray(def.options) ? (def.options as string[]) : [];
          if (!options.includes(item.value)) {
            throw AppError.badRequest(`"${def.label}" does not allow the value "${item.value}"`);
          }
        }

        await tx.studentCustomFieldValue.upsert({
          where: { studentId_fieldDefinitionId: { studentId, fieldDefinitionId: def.id } },
          create: {
            id: randomUUID(),
            tenantId,
            studentId,
            fieldDefinitionId: def.id,
            value: item.value,
            updatedByUserId: auth.userId,
          },
          update: {
            value: item.value,
            updatedByUserId: auth.userId,
          },
        });
      }
    });

    // Return the merged view (same shape as GET) so the frontend can
    // simply replace its state with the response.
    const rows = await runWithTenant(tenantId, (tx) => studentCustomFieldValueRows(tx, studentId));

    res.json({ data: rows });
  },
);
