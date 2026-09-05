import { Router } from 'express';
import { subjectsRouter } from './subjects';
import { sectionSubjectsRouter, sectionSubjectAdminRouter } from './sectionSubjects';
import { timetableRouter } from './timetable';
import { homeworkRouter } from './homework';
import { courseMaterialsRouter } from './courseMaterials';

export const academicsRouter = Router();

academicsRouter.use('/subjects', subjectsRouter);
academicsRouter.use('/sections/:sectionId/subjects', sectionSubjectsRouter);
academicsRouter.use('/section-subjects', sectionSubjectAdminRouter);
academicsRouter.use('/timetable', timetableRouter);
academicsRouter.use('/homework', homeworkRouter);
academicsRouter.use('/course-materials', courseMaterialsRouter);
