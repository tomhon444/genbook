// Response shapes of ronaldo-service /api/v1/genbookno (books/* and the read API).

export type AuditEntry = { actorId: string; event: string; details: unknown; createdAt: string };

export type BookDocument = {
  id: string; number: string; numberYear: number; subject: string; recipient: string;
  issuanceKind: 'normal' | 'backdated'; seriesId: string; mainNumber: number; subNumber: number;
  recipientDepartmentIds: string[]; externalOrganization: string; signer: string; signerName: string;
  documentDate: string; issuedAt: string; confidential: boolean; published: boolean; cancelled: boolean; cancelReason: string;
  allocationStatus: 'allocated'; hasPdf: boolean; pdfPending: boolean; ownerId: string; ownerDepartmentId: string;
  ownerDepartmentName: string; recipientDepartments: { id: string; name: string }[]; version: number; audit?: AuditEntry[];
};

export type HistoricalDetails = {
  recipients: { sourceId: string; text: string | null }[];
  destinations: { sourceId: string; kind: 'internal' | 'external' | 'unknown'; value: string | null }[];
  signer: { kind: 'position' | 'staff' | 'unknown'; typeCode: string | null; reference: string | null };
  legacyActorId: string | null; recordedAtText: string | null; updatedAtText: string | null;
  timestampTimeZone: 'unverified'; attachmentVerification: 'unverified';
};

export type HistoricalDocument = {
  sourceSha256: string; sourceId: string; number: string; numberYear: number; subject: string; documentDate: string;
  confidential: boolean; published: boolean; cancelled: boolean; ownerId: string; ownerDepartmentId: string;
  pdfPending: boolean; details: HistoricalDetails | null;
};
