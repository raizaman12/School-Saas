import { Router } from 'express';
import { academicYearsRouter } from './academicYears';
import { schoolClassesRouter } from './schoolClasses';
import { sectionsRouter } from './sections';
import { studentsRouter } from './students';
import { guardiansRouter } from './guardians';
import { transferCertificatesRouter } from './transferCertificates';
import { studentLeaveRequestsRouter } from './studentLeaveRequests';

export const sisRouter = Router();

sisRouter.use('/academic-years', academicYearsRouter);
sisRouter.use('/classes', schoolClassesRouter);
sisRouter.use('/sections', sectionsRouter);
sisRouter.use('/students', studentsRouter);
sisRouter.use('/guardians', guardiansRouter);
// Its own route paths already carry the full `/students/:studentId/...`
// and `/transfer-certificates/:id` prefixes, so it's mounted at the root
// rather than nested under another prefix here.
sisRouter.use('/', transferCertificatesRouter);
sisRouter.use('/student-leave-requests', studentLeaveRequestsRouter);
