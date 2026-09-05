import { Router } from 'express';
import { accessGrantsRouter } from './accessGrants';
import { questionBankRouter } from './questionBank';
import { generatedPapersRouter } from './generate';

export const examGeneratorModuleRouter = Router();
examGeneratorModuleRouter.use('/exam-generator/access-grants', accessGrantsRouter);
examGeneratorModuleRouter.use('/exam-generator/questions', questionBankRouter);
examGeneratorModuleRouter.use('/exam-generator/papers', generatedPapersRouter);
