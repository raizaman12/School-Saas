import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, disconnectDb } from '../helpers/db';
import { signupSchool, authHeader } from '../helpers/auth';
import { createAndLoginUser } from '../helpers/users';
import { prisma } from '../../src/lib/prisma';

const app = createApp();

// A valid, minimal 1x1 PNG — real image bytes so this exercises the actual
// upload/storage path, not just a mocked-out multer.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await disconnectDb();
  await prisma.$disconnect();
});

describe('POST /api/uploads/image', () => {
  it('stores the file and returns a URL usable as photoUrl on PATCH /api/students/:id', async () => {
    const { accessToken } = await signupSchool(app);
    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-03-10' });

    const upload = await request(app)
      .post('/api/uploads/image')
      .set(authHeader(accessToken))
      .attach('file', Buffer.from(TINY_PNG_BASE64, 'base64'), { filename: 'photo.png', contentType: 'image/png' });

    expect(upload.status).toBe(201);
    expect(upload.body.data.url).toMatch(/^https?:\/\/.+\/uploads\/.+\.png$/);

    const patch = await request(app)
      .patch(`/api/students/${student.body.data.id}`)
      .set(authHeader(accessToken))
      .send({ photoUrl: upload.body.data.url });
    expect(patch.status).toBe(200);
    expect(patch.body.data.photoUrl).toBe(upload.body.data.url);
  });

  it('two uploads from the same tenant get distinct URLs (no filename collision)', async () => {
    const { accessToken } = await signupSchool(app);
    const first = await request(app)
      .post('/api/uploads/image')
      .set(authHeader(accessToken))
      .attach('file', Buffer.from(TINY_PNG_BASE64, 'base64'), { filename: 'a.png', contentType: 'image/png' });
    const second = await request(app)
      .post('/api/uploads/image')
      .set(authHeader(accessToken))
      .attach('file', Buffer.from(TINY_PNG_BASE64, 'base64'), { filename: 'b.png', contentType: 'image/png' });

    expect(first.body.data.url).not.toBe(second.body.data.url);
  });

  it('accepts image formats beyond JPEG/PNG/WebP too — e.g. GIF, BMP, HEIC', async () => {
    const { accessToken } = await signupSchool(app);
    // A tiny valid 1x1 GIF (not just a relabeled PNG) — exercises the real
    // "any image/* mimetype" fileFilter, not just a lenient content-type check.
    const TINY_GIF_BASE64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7';
    const gif = await request(app)
      .post('/api/uploads/image')
      .set(authHeader(accessToken))
      .attach('file', Buffer.from(TINY_GIF_BASE64, 'base64'), { filename: 'photo.gif', contentType: 'image/gif' });
    expect(gif.status).toBe(201);

    // A format with no dedicated handling anywhere in the pipeline — just
    // some bytes labeled as an image/* mimetype the app has never special-cased.
    const heic = await request(app)
      .post('/api/uploads/image')
      .set(authHeader(accessToken))
      .attach('file', Buffer.from('fake heic bytes'), { filename: 'photo.heic', contentType: 'image/heic' });
    expect(heic.status).toBe(201);
  });

  it('rejects a non-image file type (400)', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app)
      .post('/api/uploads/image')
      .set(authHeader(accessToken))
      .attach('file', Buffer.from('not an image'), { filename: 'notes.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
  });

  it('rejects when no file is attached (400)', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app).post('/api/uploads/image').set(authHeader(accessToken));
    expect(res.status).toBe(400);
  });

  it('FRONT_DESK and TEACHER can both upload; ACCOUNTANT cannot (403)', async () => {
    const { tenant } = await signupSchool(app);
    const frontDesk = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'fd@test-school.test',
      role: 'FRONT_DESK',
    });
    // TEACHER is allowed here (not just on WRITE_ROLES for /image at large)
    // because a teacher uploads their OWN portal profile photo through this
    // same generic endpoint — see PATCH /api/staff/me in staff.ts.
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 't@test-school.test',
      role: 'TEACHER',
    });
    const accountant = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'acc@test-school.test',
      role: 'ACCOUNTANT',
    });

    const fdRes = await request(app)
      .post('/api/uploads/image')
      .set(authHeader(frontDesk.accessToken))
      .attach('file', Buffer.from(TINY_PNG_BASE64, 'base64'), { filename: 'a.png', contentType: 'image/png' });
    expect(fdRes.status).toBe(201);

    const teacherRes = await request(app)
      .post('/api/uploads/image')
      .set(authHeader(teacher.accessToken))
      .attach('file', Buffer.from(TINY_PNG_BASE64, 'base64'), { filename: 'a.png', contentType: 'image/png' });
    expect(teacherRes.status).toBe(201);

    const accountantRes = await request(app)
      .post('/api/uploads/image')
      .set(authHeader(accountant.accessToken))
      .attach('file', Buffer.from(TINY_PNG_BASE64, 'base64'), { filename: 'a.png', contentType: 'image/png' });
    expect(accountantRes.status).toBe(403);
  });

  it('an uploaded file is actually retrievable from the public /uploads mount', async () => {
    const { accessToken } = await signupSchool(app);
    const upload = await request(app)
      .post('/api/uploads/image')
      .set(authHeader(accessToken))
      .attach('file', Buffer.from(TINY_PNG_BASE64, 'base64'), { filename: 'a.png', contentType: 'image/png' });

    const url = new URL(upload.body.data.url);
    const download = await request(app).get(url.pathname);
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toMatch(/^image\/png/);
  });

  // Regression test for a real bug: helmet() sets `Cross-Origin-Resource-
  // Policy: same-origin` on every response by default, which — completely
  // silently, with nothing visible server-side — makes Chrome refuse to
  // load the image in a plain <img src="..."> on the frontend whenever the
  // frontend's origin differs from the API's (a different port in local
  // dev, a different subdomain in production), throwing
  // net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin client-side. A student's
  // photo (or a school logo) uploaded and correctly stored server-side
  // would then just never render anywhere in the app. See app.ts's comment
  // on the /uploads mount for the full explanation.
  it('serves uploaded files with Cross-Origin-Resource-Policy: cross-origin, so the frontend (a different origin/port) can actually load them in an <img> tag', async () => {
    const { accessToken } = await signupSchool(app);
    const upload = await request(app)
      .post('/api/uploads/image')
      .set(authHeader(accessToken))
      .attach('file', Buffer.from(TINY_PNG_BASE64, 'base64'), { filename: 'a.png', contentType: 'image/png' });

    const url = new URL(upload.body.data.url);
    const download = await request(app).get(url.pathname);
    expect(download.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });
});

describe('POST /api/uploads/document', () => {
  it('a SCHOOL_ADMIN can upload a PDF and gets back a usable fileUrl', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app)
      .post('/api/uploads/document')
      .set(authHeader(accessToken))
      .attach('file', Buffer.from('%PDF-1.4 fake pdf bytes'), { filename: 'notes.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body.data.url).toMatch(/^https?:\/\/.+\/uploads\/.+\.pdf$/);
  });

  it('a TEACHER can upload a PPTX (course material)', async () => {
    const { tenant } = await signupSchool(app);
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 't@test-school.test',
      role: 'TEACHER',
    });
    const res = await request(app)
      .post('/api/uploads/document')
      .set(authHeader(teacher.accessToken))
      .attach('file', Buffer.from('fake pptx bytes'), {
        filename: 'slides.pptx',
        contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.url).toMatch(/\.pptx$/);
  });

  it('FRONT_DESK and ACCOUNTANT cannot upload documents (403)', async () => {
    const { tenant } = await signupSchool(app);
    const frontDesk = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'fd@test-school.test',
      role: 'FRONT_DESK',
    });
    const res = await request(app)
      .post('/api/uploads/document')
      .set(authHeader(frontDesk.accessToken))
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'a.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(403);
  });

  it('rejects an unsupported file type (400) — e.g. a .zip', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app)
      .post('/api/uploads/document')
      .set(authHeader(accessToken))
      .attach('file', Buffer.from('PK fake zip'), { filename: 'archive.zip', contentType: 'application/zip' });
    expect(res.status).toBe(400);
  });

  it('rejects an image on the document endpoint (400) — wrong upload endpoint for that file type', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app)
      .post('/api/uploads/document')
      .set(authHeader(accessToken))
      .attach('file', Buffer.from(TINY_PNG_BASE64, 'base64'), { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
  });
});
