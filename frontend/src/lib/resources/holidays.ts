import { api } from "@/lib/api";

export interface Holiday {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

export const holidaysApi = {
  list: (params: { from?: string; to?: string } = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== "") as [string, string][],
    ).toString();
    return api.get<{ data: Holiday[] }>(`/api/holidays${qs ? `?${qs}` : ""}`).then((r) => r.data);
  },
  create: (input: { name: string; startDate: string; endDate: string }) =>
    api.post<{ data: Holiday }>("/api/holidays", input).then((r) => r.data),
  remove: (id: string) => api.delete<void>(`/api/holidays/${id}`),
};
