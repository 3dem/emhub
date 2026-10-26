import { ProtocolNode } from "./protocolNode";

export interface Project {
  id: string;
  name: string;
  shortName: string;
  description: string;
  createdAt: Date;
  updatedAt?: Date;
  status: string;
  protocolsCount?: string;
  diskUsage?: string;
  protocols?: Record<string, ProtocolNode>;
  isShared: boolean,
  isOwner: boolean,
  permission: string,
  projectOwnerId: string | number;
  thumbnailUrl?: string | null;
  thumbnailRebuildUrl?: string | null;
  thumbnailItemsUrl?: string | null;
  thumbnailVersion?: string | number | null;
}