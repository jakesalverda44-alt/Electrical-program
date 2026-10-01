// Level 2 learning — the /api/learning client (Settings section, the run strip,
// "Make a lesson from this answer"). Bodies are the server's own field names.
import api from './client';

export type LessonStatus = 'proposed' | 'approved' | 'dismissed' | 'retired';
export type ScopeKind = 'all' | 'project_type' | 'account';
export interface LessonEvidence { bidId: string; bidName: string; itemId: string; answer: string; reason?: string | null; at: string }
export interface Lesson {
  id: string; lineageId: string; version: number; text: string; appliesTo: Array<'counter' | 'review'>;
  scopeKind: ScopeKind; scopeValue: string | null; status: LessonStatus; evidence: LessonEvidence[]; pattern: string;
  suggestedScope: { kind: ScopeKind; value: string | null; label: string } | null; proposedAt: string;
}
export interface Example {
  id: string; polarity: 'positive' | 'negative'; meaning: { label: string; description: string; deviceClass: string | null };
  confusedWith: { description: string } | null; notADevice: boolean; sourceBidName: string | null; sourceBidId: string | null;
  status: 'candidate' | 'active' | 'retired'; conflicted: boolean; createdAt: string; sheetLabel: string | null;
}
export interface Release { id: number; exampleIds: string[]; lessonIds: string[]; status: string; eval: Record<string, unknown> | null; createdAt: string; activatedAt: string | null }
export interface LearningRecord {
  releaseId: number | null;
  examplesUsed: Array<{ id: string; targetKey: string; polarity: 'positive' | 'negative'; sourceBidName: string | null; meaning: string; sheets: string[] }>;
  lessonsUsed: Array<{ lessonId: string; version: number; text: string; sheets: string[] }>;
  tokensEst: number;
}
export interface BidLearning { learning: LearningRecord | null; reviewHints: Array<{ itemId: string; title: string; hints: Array<{ lessonId: string; version: number; text: string }> }>; off: { all: boolean; examples: string[]; lessons: string[] } }

export const learningApi = {
  lessons: (status?: LessonStatus) => api.get<{ lessons: Lesson[] }>('/learning/lessons', status ? { params: { status } } : undefined).then(r => r.data.lessons),
  checkLessons: () => api.post<{ proposed: number; appended: number }>('/learning/lessons/check', {}).then(r => r.data),
  approve: (id: string, body: { text?: string; scope_kind: ScopeKind; scope_value?: string | null; applies_to: Array<'counter' | 'review'> }) => api.post<{ lesson: Lesson }>(`/learning/lessons/${id}/approve`, body).then(r => r.data.lesson),
  dismiss: (id: string) => api.post<{ lesson: Lesson }>(`/learning/lessons/${id}/dismiss`, {}).then(r => r.data.lesson),
  retire: (id: string) => api.post<{ lesson: Lesson }>(`/learning/lessons/${id}/retire`, {}).then(r => r.data.lesson),
  restore: (id: string) => api.post<{ lesson: Lesson }>(`/learning/lessons/${id}/restore`, {}).then(r => r.data.lesson),
  versions: (id: string) => api.get<{ versions: Lesson[] }>(`/learning/lessons/${id}/versions`).then(r => r.data.versions),
  fromItem: (bidId: string, itemId: string) => api.post<{ lesson: Lesson }>('/learning/lessons/from-item', { bidId, itemId }).then(r => r.data.lesson),
  examples: (status?: string) => api.get<{ examples: Example[] }>('/learning/examples', status ? { params: { status } } : undefined).then(r => r.data.examples),
  retireExample: (id: string) => api.post(`/learning/examples/${id}/retire`, {}),
  releases: () => api.get<{ releases: Release[]; activeId: number | null; waiting: { examples: number; lessons: number }; estimatedCost: string }>('/learning/releases').then(r => r.data),
  previewCheck: () => api.get<{ jobs: Array<{ label: string; willRun: boolean; note: string }>; estimatedCost: string }>('/learning/releases/preview').then(r => r.data),
  createRelease: () => api.post<{ release: Release }>('/learning/releases', {}).then(r => r.data.release),
  checkRelease: (id: number) => api.post(`/learning/releases/${id}/check`, { confirmCost: true }),
  rollback: (id: number) => api.post(`/learning/releases/${id}/rollback`, {}),
  bid: (bidId: string) => api.get<BidLearning>(`/learning/bids/${bidId}`).then(r => r.data),
  setOff: (bidId: string, body: { refKind: 'example' | 'lesson' | 'all'; refId?: string }) => api.post<{ off: BidLearning['off']; note: string }>(`/learning/bids/${bidId}/off`, body).then(r => r.data),
};
