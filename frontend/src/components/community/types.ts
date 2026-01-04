export type CommunityThreadType = 'CHANNEL' | 'DM';

export type CommunityChannel = {
  id: string;
  threadType: 'CHANNEL';
  name?: string | null;
  description?: string | null;
  isPrivate: boolean;
  createdAt: string;
  lastMessageAt?: string | null;
};

export type CommunityDmThread = {
  id: string;
  threadType: 'DM';
  isPrivate: boolean;
  createdAt: string;
  lastMessageAt?: string | null;
  participants?: { id: string; name: string; email: string }[];
};

export type MessageAttachment = {
  id: string;
  messageId: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  thumbnailUrl?: string | null;
  width?: number | null;
  height?: number | null;
};

export type MessageReaction = {
  emoji: string;
  count: number;
  userIds: string[];
};

export type ReplyPreview = {
  id: string;
  senderId: string;
  senderName?: string | null;
  body: string;
};

export type CommunityMessage = {
  id: string;
  threadId: string;
  senderId: string;
  senderName?: string | null;
  body: string;
  createdAt: string;
  isEdited?: boolean;
  editedAt?: string | null;
  isDeleted?: boolean;
  deletedAt?: string | null;
  replyToMessageId?: string | null;
  replyPreview?: ReplyPreview | null;
  attachments?: MessageAttachment[];
  reactions?: MessageReaction[];
};

export type CommunityOverview = {
  channels: CommunityChannel[];
  dms: CommunityDmThread[];
};

export type DirectoryUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type UnreadInfo = {
  threadId: string;
  unreadCount: number;
};

export type TypingIndicator = {
  userId: string;
  userName: string;
};

export type PinnedMessage = {
  id: string;
  threadId: string;
  messageId: string;
  pinnedBy: string;
  pinnedAt: string;
  message?: CommunityMessage;
};

export type User = {
  id: string;
  name: string;
  email: string;
  role: string;
};
