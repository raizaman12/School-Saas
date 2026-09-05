import { z } from 'zod';

const customFieldTypeSchema = z.enum(['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT']);

export const createCustomFieldDefinitionSchema = z
  .object({
    label: z.string().min(2, 'Required').max(150),
    fieldType: customFieldTypeSchema,
    // Only meaningful (and required) when fieldType === 'SELECT' — checked
    // in the route handler since it's a cross-field rule zod's object
    // shape alone can't express cleanly without .refine noise.
    options: z.array(z.string().min(1).max(150)).max(50).optional(),
    required: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((v) => v.fieldType !== 'SELECT' || (v.options && v.options.length >= 1), {
    message: 'At least one option is required for a Dropdown field',
    path: ['options'],
  });
export type CreateCustomFieldDefinitionInput = z.infer<typeof createCustomFieldDefinitionSchema>;

// Updating a definition never changes fieldType — changing the data type of
// a field that may already have values stored against it would make those
// values meaningless (a "TEXT" answer suddenly reinterpreted as "NUMBER").
// A school that needs a different type is expected to disable the old
// field and create a new one, same as most simple form builders.
export const updateCustomFieldDefinitionSchema = z
  .object({
    label: z.string().min(2).max(150).optional(),
    options: z.array(z.string().min(1).max(150)).max(50).optional(),
    required: z.boolean().optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  })
  .strict();
export type UpdateCustomFieldDefinitionInput = z.infer<typeof updateCustomFieldDefinitionSchema>;

// Bulk upsert of a student's custom field values — the frontend always
// saves the whole "extra info" section of a student in one go, same as it
// does for the health profile. Values are stored as text and parsed back
// per fieldType by the caller; an empty string clears the value (removes
// the row) rather than storing "".
export const putStudentCustomFieldValuesSchema = z.object({
  values: z
    .array(
      z.object({
        fieldDefinitionId: z.string().uuid(),
        value: z.string().max(2000),
      }),
    )
    .max(200),
});
export type PutStudentCustomFieldValuesInput = z.infer<typeof putStudentCustomFieldValuesSchema>;
