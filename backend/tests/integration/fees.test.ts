import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, disconnectDb, ownerDb } from '../helpers/db';
import { signupSchool, authHeader } from '../helpers/auth';
import { createAndLoginUser } from '../helpers/users';
import { prisma } from '../../src/lib/prisma';
import { closePdfBrowser } from '../../src/lib/pdfBrowser';

const app = createApp();

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await disconnectDb();
  await prisma.$disconnect();
  await closePdfBrowser();
});

async function setupFeeFixture(accessToken: string) {
  const year = await request(app)
    .post('/api/academic-years')
    .set(authHeader(accessToken))
    .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
  const cls = await request(app)
    .post('/api/classes')
    .set(authHeader(accessToken))
    .send({ name: 'Class 5', order: 5 });
  const section = await request(app)
    .post('/api/sections')
    .set(authHeader(accessToken))
    .send({ schoolClassId: cls.body.data.id, academicYearId: year.body.data.id, name: 'A' });
  const student = await request(app)
    .post('/api/students')
    .set(authHeader(accessToken))
    .send({
      fullName: 'Ahmed Khan',
      gender: 'MALE',
      dateOfBirth: '2015-01-01',
      sectionId: section.body.data.id,
      academicYearId: year.body.data.id,
    });
  const category = await request(app)
    .post('/api/fee-categories')
    .set(authHeader(accessToken))
    .send({ name: 'Tuition Fee' });
  await request(app)
    .post('/api/fee-structure-items')
    .set(authHeader(accessToken))
    .send({
      academicYearId: year.body.data.id,
      schoolClassId: cls.body.data.id,
      feeCategoryId: category.body.data.id,
      amount: 5000,
      frequency: 'MONTHLY',
    });

  return { year: year.body.data, section: section.body.data, student: student.body.data, category: category.body.data };
}

describe('Fee categories', () => {
  it('rejects a duplicate category name that only differs by case or surrounding whitespace', async () => {
    const { accessToken } = await signupSchool(app);

    const first = await request(app)
      .post('/api/fee-categories')
      .set(authHeader(accessToken))
      .send({ name: 'Tuition Fee' });
    expect(first.status).toBe(201);

    const sameCase = await request(app)
      .post('/api/fee-categories')
      .set(authHeader(accessToken))
      .send({ name: '  Tuition Fee  ' });
    expect(sameCase.status).toBe(409);

    const differentCase = await request(app)
      .post('/api/fee-categories')
      .set(authHeader(accessToken))
      .send({ name: 'tuition fee' });
    expect(differentCase.status).toBe(409);

    const list = await request(app).get('/api/fee-categories').set(authHeader(accessToken));
    expect(list.body.data).toHaveLength(1);
  });

  it('trims surrounding whitespace from a newly created category name', async () => {
    const { accessToken } = await signupSchool(app);

    const res = await request(app)
      .post('/api/fee-categories')
      .set(authHeader(accessToken))
      .send({ name: '  Exam Fee  ' });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Exam Fee');
  });

  // Real gap this covers: building the fee category/structure list is
  // routine Accountant work in a Pakistani school office, alongside
  // collecting fees — this was SCHOOL_ADMIN-only for no functional reason.
  it('ACCOUNTANT can create a fee category', async () => {
    const { tenant } = await signupSchool(app);
    const accountant = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'accountant@test-school.test',
      role: 'ACCOUNTANT',
    });

    const res = await request(app)
      .post('/api/fee-categories')
      .set(authHeader(accountant.accessToken))
      .send({ name: 'Transport Fee' });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Transport Fee');
  });
});

describe('Fee structure', () => {
  it('rejects a duplicate fee structure item for the same class/category/year', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, category } = await setupFeeFixture(accessToken);
    const cls = await request(app).get('/api/classes').set(authHeader(accessToken));

    const dup = await request(app)
      .post('/api/fee-structure-items')
      .set(authHeader(accessToken))
      .send({
        academicYearId: year.id,
        schoolClassId: cls.body.data[0].id,
        feeCategoryId: category.id,
        amount: 6000,
        frequency: 'MONTHLY',
      });
    expect(dup.status).toBe(409);
  });

  it('GET returns each item with its feeCategory, schoolClass, and academicYear names populated', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, category } = await setupFeeFixture(accessToken);
    const cls = await request(app).get('/api/classes').set(authHeader(accessToken));

    const res = await request(app).get('/api/fee-structure-items').set(authHeader(accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toEqual(
      expect.objectContaining({
        amount: '5000',
        frequency: 'MONTHLY',
        feeCategory: expect.objectContaining({ id: category.id, name: 'Tuition Fee' }),
        schoolClass: { id: cls.body.data[0].id, name: cls.body.data[0].name },
        academicYear: { id: year.id, name: year.name },
      }),
    );
  });

  it('TEACHER cannot access fee endpoints (403)', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    await setupFeeFixture(accessToken);
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacher@test-school.test',
      role: 'TEACHER',
    });
    const res = await request(app).get('/api/fee-categories').set(authHeader(teacher.accessToken));
    expect(res.status).toBe(403);
  });

  it('ACCOUNTANT can create a fee structure item', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { year } = await setupFeeFixture(accessToken);
    const cls = await request(app).get('/api/classes').set(authHeader(accessToken));
    const secondCategory = await request(app)
      .post('/api/fee-categories')
      .set(authHeader(accessToken))
      .send({ name: 'Sports Fee' });
    const accountant = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'accountant2@test-school.test',
      role: 'ACCOUNTANT',
    });

    const res = await request(app)
      .post('/api/fee-structure-items')
      .set(authHeader(accountant.accessToken))
      .send({
        academicYearId: year.id,
        schoolClassId: cls.body.data[0].id,
        feeCategoryId: secondCategory.body.data.id,
        amount: 1200,
        frequency: 'MONTHLY',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBe('1200');
  });
});

describe('Invoice bulk generation', () => {
  it('generates one invoice per active student and skips on re-run for the same period', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, section } = await setupFeeFixture(accessToken);

    const gen1 = await request(app)
      .post('/api/invoices/bulk-generate')
      .set(authHeader(accessToken))
      .send({
        sectionId: section.id,
        academicYearId: year.id,
        period: '2026-02',
        issueDate: '2026-02-01',
        dueDate: '2026-02-10',
      });
    expect(gen1.status).toBe(201);
    expect(gen1.body.data.generated).toBe(1);
    expect(gen1.body.data.invoices[0].totalAmount).toBe('5000');

    const gen2 = await request(app)
      .post('/api/invoices/bulk-generate')
      .set(authHeader(accessToken))
      .send({
        sectionId: section.id,
        academicYearId: year.id,
        period: '2026-02',
        issueDate: '2026-02-01',
        dueDate: '2026-02-10',
      });
    expect(gen2.status).toBe(201);
    expect(gen2.body.data.generated).toBe(0);
    expect(gen2.body.data.skipped).toBe(1);
  });

  it('rejects generation when no fee structure exists for the class', async () => {
    const { accessToken } = await signupSchool(app);
    const year = await request(app)
      .post('/api/academic-years')
      .set(authHeader(accessToken))
      .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
    const cls = await request(app).post('/api/classes').set(authHeader(accessToken)).send({ name: 'Class 6', order: 6 });
    const section = await request(app)
      .post('/api/sections')
      .set(authHeader(accessToken))
      .send({ schoolClassId: cls.body.data.id, academicYearId: year.body.data.id, name: 'A' });

    const res = await request(app)
      .post('/api/invoices/bulk-generate')
      .set(authHeader(accessToken))
      .send({
        sectionId: section.body.data.id,
        academicYearId: year.body.data.id,
        period: '2026-02',
        issueDate: '2026-02-01',
        dueDate: '2026-02-10',
      });
    expect(res.status).toBe(400);
  });
});

describe('Payments', () => {
  async function generateInvoice(accessToken: string, year: { id: string }, section: { id: string }) {
    const gen = await request(app)
      .post('/api/invoices/bulk-generate')
      .set(authHeader(accessToken))
      .send({
        sectionId: section.id,
        academicYearId: year.id,
        period: '2026-02',
        issueDate: '2026-02-01',
        dueDate: '2026-02-10',
      });
    return gen.body.data.invoices[0];
  }

  it('applies a partial payment and updates invoice status to PARTIALLY_PAID', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, section } = await setupFeeFixture(accessToken);
    const invoice = await generateInvoice(accessToken, year, section);

    const pay = await request(app)
      .post(`/api/invoices/${invoice.id}/payments`)
      .set(authHeader(accessToken))
      .send({ amount: 2000, method: 'CASH', idempotencyKey: 'key-00001' });

    expect(pay.status).toBe(201);
    expect(pay.body.data.invoice.status).toBe('PARTIALLY_PAID');
    expect(pay.body.data.invoice.paidAmount).toBe('2000');
    // Regression guard: the invoice detail page renders `invoice.student.fullName`
    // straight from whatever this route returns — a bare Invoice row with no
    // `student`/`lineItems`/`payments` crashed it immediately after every payment
    // (see INVOICE_DETAIL_INCLUDE's doc comment). Must match GET /:id's shape.
    expect(pay.body.data.invoice.student.fullName).toEqual(expect.any(String));
    expect(Array.isArray(pay.body.data.invoice.lineItems)).toBe(true);
    expect(Array.isArray(pay.body.data.invoice.payments)).toBe(true);
  });

  it('fully paying an invoice sets status to PAID', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, section } = await setupFeeFixture(accessToken);
    const invoice = await generateInvoice(accessToken, year, section);

    const pay = await request(app)
      .post(`/api/invoices/${invoice.id}/payments`)
      .set(authHeader(accessToken))
      .send({ amount: 5000, method: 'CASH', idempotencyKey: 'key-full-payment' });

    expect(pay.body.data.invoice.status).toBe('PAID');
  });

  it('rejects a payment that exceeds the remaining balance', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, section } = await setupFeeFixture(accessToken);
    const invoice = await generateInvoice(accessToken, year, section);

    const res = await request(app)
      .post(`/api/invoices/${invoice.id}/payments`)
      .set(authHeader(accessToken))
      .send({ amount: 6000, method: 'CASH', idempotencyKey: 'key-overpay' });
    expect(res.status).toBe(400);
  });

  it('idempotency: replaying the SAME idempotencyKey does not double-charge', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, section } = await setupFeeFixture(accessToken);
    const invoice = await generateInvoice(accessToken, year, section);

    const first = await request(app)
      .post(`/api/invoices/${invoice.id}/payments`)
      .set(authHeader(accessToken))
      .send({ amount: 2000, method: 'CASH', idempotencyKey: 'retry-key-001' });
    expect(first.status).toBe(201);

    const replay = await request(app)
      .post(`/api/invoices/${invoice.id}/payments`)
      .set(authHeader(accessToken))
      .send({ amount: 2000, method: 'CASH', idempotencyKey: 'retry-key-001' });
    expect(replay.status).toBe(200); // replay, not a new creation

    const detail = await request(app).get(`/api/invoices/${invoice.id}`).set(authHeader(accessToken));
    expect(detail.body.data.payments).toHaveLength(1);
    expect(detail.body.data.paidAmount).toBe('2000');
  });

  it('FRONT_DESK can record a payment but not create fee structure items', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { year, section } = await setupFeeFixture(accessToken);
    const invoice = await generateInvoice(accessToken, year, section);
    const frontDesk = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'fd@test-school.test',
      role: 'FRONT_DESK',
    });

    const pay = await request(app)
      .post(`/api/invoices/${invoice.id}/payments`)
      .set(authHeader(frontDesk.accessToken))
      .send({ amount: 1000, method: 'CASH', idempotencyKey: 'fd-key-001' });
    expect(pay.status).toBe(201);

    const denied = await request(app)
      .post('/api/fee-structure-items')
      .set(authHeader(frontDesk.accessToken))
      .send({ academicYearId: year.id, schoolClassId: section.id, feeCategoryId: '00000000-0000-0000-0000-000000000000', amount: 100, frequency: 'MONTHLY' });
    expect(denied.status).toBe(403);
  });
});

describe('Mark fully paid', () => {
  async function generateInvoice(accessToken: string, year: { id: string }, section: { id: string }) {
    const gen = await request(app)
      .post('/api/invoices/bulk-generate')
      .set(authHeader(accessToken))
      .send({
        sectionId: section.id,
        academicYearId: year.id,
        period: '2026-02',
        issueDate: '2026-02-01',
        dueDate: '2026-02-10',
      });
    return gen.body.data.invoices[0];
  }

  it('pays off the full remaining balance in one call, without the caller specifying an amount', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, section } = await setupFeeFixture(accessToken);
    const invoice = await generateInvoice(accessToken, year, section);

    const res = await request(app).patch(`/api/invoices/${invoice.id}/mark-paid`).set(authHeader(accessToken)).send({});

    expect(res.status).toBe(200);
    expect(res.body.data.invoice.status).toBe('PAID');
    expect(res.body.data.invoice.paidAmount).toBe('5000');
    expect(res.body.data.payment.amount).toBe('5000');
    expect(res.body.data.payment.method).toBe('CASH'); // default when no method given
    // Regression guard — see the Payments describe block's matching comment.
    expect(res.body.data.invoice.student.fullName).toEqual(expect.any(String));
    expect(Array.isArray(res.body.data.invoice.lineItems)).toBe(true);
    expect(Array.isArray(res.body.data.invoice.payments)).toBe(true);
  });

  it('tops up an already-partially-paid invoice for just the remainder', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, section } = await setupFeeFixture(accessToken);
    const invoice = await generateInvoice(accessToken, year, section);
    await request(app)
      .post(`/api/invoices/${invoice.id}/payments`)
      .set(authHeader(accessToken))
      .send({ amount: 2000, method: 'CASH', idempotencyKey: 'partial-before-mark-paid' });

    const res = await request(app)
      .patch(`/api/invoices/${invoice.id}/mark-paid`)
      .set(authHeader(accessToken))
      .send({ method: 'BANK_TRANSFER' });

    expect(res.status).toBe(200);
    expect(res.body.data.invoice.status).toBe('PAID');
    expect(res.body.data.invoice.paidAmount).toBe('5000');
    expect(res.body.data.payment.amount).toBe('3000'); // only the remaining 5000 - 2000
  });

  it('is idempotent — calling it again on an already-PAID invoice does not double-charge', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, section } = await setupFeeFixture(accessToken);
    const invoice = await generateInvoice(accessToken, year, section);

    await request(app).patch(`/api/invoices/${invoice.id}/mark-paid`).set(authHeader(accessToken)).send({});
    const again = await request(app).patch(`/api/invoices/${invoice.id}/mark-paid`).set(authHeader(accessToken)).send({});

    expect(again.status).toBe(200);
    expect(again.body.data.invoice.status).toBe('PAID');
    expect(again.body.data.payment).toBeNull(); // no second Payment row

    const detail = await request(app).get(`/api/invoices/${invoice.id}`).set(authHeader(accessToken));
    expect(detail.body.data.payments).toHaveLength(1);
    expect(detail.body.data.paidAmount).toBe('5000');
  });

  it('refuses to mark a cancelled invoice as paid', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, section } = await setupFeeFixture(accessToken);
    const invoice = await generateInvoice(accessToken, year, section);
    await ownerDb.invoice.update({ where: { id: invoice.id }, data: { status: 'CANCELLED' } });

    const res = await request(app).patch(`/api/invoices/${invoice.id}/mark-paid`).set(authHeader(accessToken)).send({});
    expect(res.status).toBe(409);
  });

  it('FRONT_DESK can mark an invoice fully paid but TEACHER cannot', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { year, section } = await setupFeeFixture(accessToken);
    const invoice = await generateInvoice(accessToken, year, section);
    const frontDesk = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'fd-markpaid@test-school.test',
      role: 'FRONT_DESK',
    });
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacher-markpaid@test-school.test',
      role: 'TEACHER',
    });

    const denied = await request(app)
      .patch(`/api/invoices/${invoice.id}/mark-paid`)
      .set(authHeader(teacher.accessToken))
      .send({});
    expect(denied.status).toBe(403);

    const allowed = await request(app)
      .patch(`/api/invoices/${invoice.id}/mark-paid`)
      .set(authHeader(frontDesk.accessToken))
      .send({});
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.invoice.status).toBe('PAID');
  });
});

describe('Revert to unpaid', () => {
  async function generateInvoice(accessToken: string, year: { id: string }, section: { id: string }) {
    const gen = await request(app)
      .post('/api/invoices/bulk-generate')
      .set(authHeader(accessToken))
      .send({
        sectionId: section.id,
        academicYearId: year.id,
        period: '2026-02',
        issueDate: '2026-02-01',
        dueDate: '2026-02-10',
      });
    return gen.body.data.invoices[0];
  }

  it('undoes a mark-fully-paid, deleting its payment and putting the invoice back to UNPAID', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { year, section } = await setupFeeFixture(accessToken);
    const invoice = await generateInvoice(accessToken, year, section);
    await request(app).patch(`/api/invoices/${invoice.id}/mark-paid`).set(authHeader(accessToken)).send({});
    const accountant = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'accountant-revert@test-school.test',
      role: 'ACCOUNTANT',
    });

    const res = await request(app)
      .patch(`/api/invoices/${invoice.id}/revert-to-unpaid`)
      .set(authHeader(accountant.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data.invoice.status).toBe('UNPAID');
    expect(res.body.data.invoice.paidAmount).toBe('0');
    // Regression guard — see the Payments describe block's matching comment.
    expect(res.body.data.invoice.student.fullName).toEqual(expect.any(String));
    expect(Array.isArray(res.body.data.invoice.lineItems)).toBe(true);
    expect(Array.isArray(res.body.data.invoice.payments)).toBe(true);

    const detail = await request(app).get(`/api/invoices/${invoice.id}`).set(authHeader(accessToken));
    expect(detail.body.data.payments).toHaveLength(0);
  });

  it('reverting an invoice finished off by a top-up payment falls back to PARTIALLY_PAID, keeping the earlier payment', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { year, section } = await setupFeeFixture(accessToken);
    const invoice = await generateInvoice(accessToken, year, section);
    await request(app)
      .post(`/api/invoices/${invoice.id}/payments`)
      .set(authHeader(accessToken))
      .send({ amount: 2000, method: 'CASH', idempotencyKey: 'revert-partial-before' });
    await request(app).patch(`/api/invoices/${invoice.id}/mark-paid`).set(authHeader(accessToken)).send({});
    const accountant = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'accountant-revert2@test-school.test',
      role: 'ACCOUNTANT',
    });

    const res = await request(app)
      .patch(`/api/invoices/${invoice.id}/revert-to-unpaid`)
      .set(authHeader(accountant.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data.invoice.status).toBe('PARTIALLY_PAID');
    expect(res.body.data.invoice.paidAmount).toBe('2000');

    const detail = await request(app).get(`/api/invoices/${invoice.id}`).set(authHeader(accessToken));
    expect(detail.body.data.payments).toHaveLength(1);
    expect(detail.body.data.payments[0].amount).toBe('2000');
  });

  it('refuses to revert an invoice that is not currently PAID', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { year, section } = await setupFeeFixture(accessToken);
    const invoice = await generateInvoice(accessToken, year, section);
    const accountant = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'accountant-revert3@test-school.test',
      role: 'ACCOUNTANT',
    });

    const res = await request(app)
      .patch(`/api/invoices/${invoice.id}/revert-to-unpaid`)
      .set(authHeader(accountant.accessToken));

    expect(res.status).toBe(409);
  });

  it('only ACCOUNTANT can revert — SCHOOL_ADMIN and FRONT_DESK are refused', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { year, section } = await setupFeeFixture(accessToken);
    const invoice = await generateInvoice(accessToken, year, section);
    await request(app).patch(`/api/invoices/${invoice.id}/mark-paid`).set(authHeader(accessToken)).send({});
    const frontDesk = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'fd-revert@test-school.test',
      role: 'FRONT_DESK',
    });

    const adminDenied = await request(app)
      .patch(`/api/invoices/${invoice.id}/revert-to-unpaid`)
      .set(authHeader(accessToken));
    expect(adminDenied.status).toBe(403);

    const frontDeskDenied = await request(app)
      .patch(`/api/invoices/${invoice.id}/revert-to-unpaid`)
      .set(authHeader(frontDesk.accessToken));
    expect(frontDeskDenied.status).toBe(403);
  });
});

describe('Student ledger', () => {
  it('computes totalBilled, totalPaid and balance across invoices', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, section, student } = await setupFeeFixture(accessToken);

    const gen = await request(app)
      .post('/api/invoices/bulk-generate')
      .set(authHeader(accessToken))
      .send({
        sectionId: section.id,
        academicYearId: year.id,
        period: '2026-02',
        issueDate: '2026-02-01',
        dueDate: '2026-02-10',
      });
    const invoice = gen.body.data.invoices[0];

    await request(app)
      .post(`/api/invoices/${invoice.id}/payments`)
      .set(authHeader(accessToken))
      .send({ amount: 3000, method: 'CASH', idempotencyKey: 'ledger-key-001' });

    const ledger = await request(app)
      .get(`/api/invoices/students/${student.id}/ledger`)
      .set(authHeader(accessToken));

    expect(ledger.status).toBe(200);
    expect(ledger.body.data.summary).toEqual({ totalBilled: 5000, totalFines: 0, totalPaid: 3000, balance: 2000 });
  });
});

describe('Late fee policy & overdue sync', () => {
  it('GET returns null when no policy has been configured yet', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app).get('/api/late-fee-policy').set(authHeader(accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('PUT creates/replaces the tenant policy; TEACHER cannot set it', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacher@test-school.test',
      role: 'TEACHER',
    });

    const denied = await request(app)
      .put('/api/late-fee-policy')
      .set(authHeader(teacher.accessToken))
      .send({ graceDays: 5, fineType: 'FIXED', fineValue: 200 });
    expect(denied.status).toBe(403);

    const put = await request(app)
      .put('/api/late-fee-policy')
      .set(authHeader(accessToken))
      .send({ graceDays: 5, fineType: 'FIXED', fineValue: 200 });
    expect(put.status).toBe(200);
    expect(put.body.data.fineType).toBe('FIXED');
    expect(put.body.data.fineValue).toBe('200');
  });

  it('rejects a PERCENTAGE policy with fineValue over 100', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app)
      .put('/api/late-fee-policy')
      .set(authHeader(accessToken))
      .send({ graceDays: 0, fineType: 'PERCENTAGE', fineValue: 150 });
    expect(res.status).toBe(400);
  });

  async function generatePastDueInvoice(accessToken: string, year: { id: string }, section: { id: string }) {
    const gen = await request(app)
      .post('/api/invoices/bulk-generate')
      .set(authHeader(accessToken))
      .send({
        sectionId: section.id,
        academicYearId: year.id,
        period: '2020-01',
        issueDate: '2020-01-01',
        dueDate: '2020-01-10',
      });
    return gen.body.data.invoices[0];
  }

  it('applies a FIXED fine and flips status to OVERDUE once past dueDate+graceDays', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, section } = await setupFeeFixture(accessToken);
    await request(app)
      .put('/api/late-fee-policy')
      .set(authHeader(accessToken))
      .send({ graceDays: 0, fineType: 'FIXED', fineValue: 300 });
    const invoice = await generatePastDueInvoice(accessToken, year, section);

    const detail = await request(app).get(`/api/invoices/${invoice.id}`).set(authHeader(accessToken));
    expect(detail.body.data.status).toBe('OVERDUE');
    expect(detail.body.data.lateFineAmount).toBe('300');
  });

  it('applies a PERCENTAGE fine computed from totalAmount', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, section } = await setupFeeFixture(accessToken);
    await request(app)
      .put('/api/late-fee-policy')
      .set(authHeader(accessToken))
      .send({ graceDays: 0, fineType: 'PERCENTAGE', fineValue: 10 });
    const invoice = await generatePastDueInvoice(accessToken, year, section);

    const detail = await request(app).get(`/api/invoices/${invoice.id}`).set(authHeader(accessToken));
    expect(detail.body.data.status).toBe('OVERDUE');
    expect(detail.body.data.lateFineAmount).toBe('500'); // 10% of 5000
  });

  it('a payment covering totalAmount but not the fine leaves the invoice OVERDUE, not PAID', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, section } = await setupFeeFixture(accessToken);
    await request(app)
      .put('/api/late-fee-policy')
      .set(authHeader(accessToken))
      .send({ graceDays: 0, fineType: 'FIXED', fineValue: 300 });
    const invoice = await generatePastDueInvoice(accessToken, year, section);

    const pay = await request(app)
      .post(`/api/invoices/${invoice.id}/payments`)
      .set(authHeader(accessToken))
      .send({ amount: 5000, method: 'CASH', idempotencyKey: 'overdue-partial-key' });
    expect(pay.status).toBe(201);
    expect(pay.body.data.invoice.status).toBe('OVERDUE');

    const full = await request(app)
      .post(`/api/invoices/${invoice.id}/payments`)
      .set(authHeader(accessToken))
      .send({ amount: 300, method: 'CASH', idempotencyKey: 'overdue-fine-key' });
    expect(full.body.data.invoice.status).toBe('PAID');
  });

  it('rejects a payment that covers totalAmount but ignores the outstanding fine', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, section } = await setupFeeFixture(accessToken);
    await request(app)
      .put('/api/late-fee-policy')
      .set(authHeader(accessToken))
      .send({ graceDays: 0, fineType: 'FIXED', fineValue: 300 });
    const invoice = await generatePastDueInvoice(accessToken, year, section);

    const overpay = await request(app)
      .post(`/api/invoices/${invoice.id}/payments`)
      .set(authHeader(accessToken))
      .send({ amount: 5301, method: 'CASH', idempotencyKey: 'exceeds-key' });
    expect(overpay.status).toBe(400);
  });

  it('does not flip status for invoices still within the due date', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, section } = await setupFeeFixture(accessToken);
    await request(app)
      .put('/api/late-fee-policy')
      .set(authHeader(accessToken))
      .send({ graceDays: 0, fineType: 'FIXED', fineValue: 300 });

    const futureDueDate = new Date();
    futureDueDate.setDate(futureDueDate.getDate() + 30);
    const gen = await request(app)
      .post('/api/invoices/bulk-generate')
      .set(authHeader(accessToken))
      .send({
        sectionId: section.id,
        academicYearId: year.id,
        period: '2099-01',
        issueDate: '2026-01-01',
        dueDate: futureDueDate.toISOString().slice(0, 10),
      });

    const detail = await request(app)
      .get(`/api/invoices/${gen.body.data.invoices[0].id}`)
      .set(authHeader(accessToken));
    expect(detail.body.data.status).toBe('UNPAID');
    expect(detail.body.data.lateFineAmount).toBe('0');
  });
});

describe('Defaulter list', () => {
  it('lists students with a past-due, unpaid invoice and excludes paid ones', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, section } = await setupFeeFixture(accessToken);
    const overdue = await request(app)
      .post('/api/invoices/bulk-generate')
      .set(authHeader(accessToken))
      .send({
        sectionId: section.id,
        academicYearId: year.id,
        period: '2020-01',
        issueDate: '2020-01-01',
        dueDate: '2020-01-10',
      });
    const invoice = overdue.body.data.invoices[0];

    const list = await request(app).get('/api/invoices/defaulters').set(authHeader(accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].invoiceId).toBe(invoice.id);
    expect(list.body.data[0].amountDue).toBe(5000);

    await request(app)
      .post(`/api/invoices/${invoice.id}/payments`)
      .set(authHeader(accessToken))
      .send({ amount: 5000, method: 'CASH', idempotencyKey: 'defaulter-clear-key' });

    const listAfterPaid = await request(app).get('/api/invoices/defaulters').set(authHeader(accessToken));
    expect(listAfterPaid.body.data).toHaveLength(0);
  });

  it('filters the defaulter list by schoolClassId', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, section } = await setupFeeFixture(accessToken);
    await request(app)
      .post('/api/invoices/bulk-generate')
      .set(authHeader(accessToken))
      .send({
        sectionId: section.id,
        academicYearId: year.id,
        period: '2020-01',
        issueDate: '2020-01-01',
        dueDate: '2020-01-10',
      });

    const otherClass = await request(app).post('/api/classes').set(authHeader(accessToken)).send({ name: 'Class 9', order: 9 });
    const otherSection = await request(app)
      .post('/api/sections')
      .set(authHeader(accessToken))
      .send({ schoolClassId: otherClass.body.data.id, academicYearId: year.id, name: 'A' });

    const list = await request(app)
      .get(`/api/invoices/defaulters?schoolClassId=${otherClass.body.data.id}`)
      .set(authHeader(accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(0);
    void otherSection;
  });
});

describe('Bank challan PDF', () => {
  it('returns a valid 3-copy PDF for an invoice', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, section } = await setupFeeFixture(accessToken);
    const gen = await request(app)
      .post('/api/invoices/bulk-generate')
      .set(authHeader(accessToken))
      .send({
        sectionId: section.id,
        academicYearId: year.id,
        period: '2026-02',
        issueDate: '2026-02-01',
        dueDate: '2026-02-10',
      });
    const invoice = gen.body.data.invoices[0];

    const pdf = await request(app)
      .get(`/api/invoices/${invoice.id}/challan-pdf`)
      .set(authHeader(accessToken))
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
  }, 30000);
});
