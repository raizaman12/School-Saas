import { z } from 'zod';
import { THEME_IDS } from '../../config/themePresets';

export const updateTenantThemeSchema = z.object({
  themeId: z.enum(THEME_IDS),
});
export type UpdateTenantThemeInput = z.infer<typeof updateTenantThemeSchema>;
