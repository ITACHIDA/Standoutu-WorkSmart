import { useState, useRef, ChangeEvent } from 'react';
import { api } from '../../lib/api';
import type { CommunityMessage, CommunityThreadType } from './types';
import { dedupeMessages, sortChannels, sortDms } from './utils';

interface UseMessageActionsProps {
  token: string | null;
  activeThreadId: string;
  activeType: CommunityThreadType | null;
  userId?: string;
}

export function useMessageActions({
  token,
  activeThreadId,
  activeType,
  userId,
}: UseMessageActionsProps) {
  const [draftMessage, setDraftMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [replyingTo, setReplyingTo] = useState<CommunityMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<CommunityMessage | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleSendMessage(
    messages: CommunityMessage[],
    setMessages: React.Dispatch<React.SetStateAction<CommunityMessage[]>>,
    setChannels?: React.Dispatch<React.SetStateAction<any[]>>,
    setDms?: React.Dispatch<React.SetStateAction<any[]>>,
    setError?: (error: string) => void,
  ) {
    if (!activeThreadId || (!draftMessage.trim() && selectedFiles.length === 0) || !token) return;
    if (selectedFiles.length > 0) {
      await handleUploadAndSend(messages, setMessages, setChannels, setDms, setError);
      return;
    }
    setSending(true);
    setError?.('');
    try {
      const payload: { body: string; replyToMessageId?: string } = { body: draftMessage.trim() };
      if (replyingTo) {
        payload.replyToMessageId = replyingTo.id;
      }
      const sent = await api<CommunityMessage>(
        `/community/threads/${activeThreadId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
        token,
      );
      setMessages((prev) => dedupeMessages([...prev, sent]));
      setDraftMessage('');
      setReplyingTo(null);
      if (activeType === 'CHANNEL' && setChannels) {
        setChannels((prev) =>
          sortChannels(prev.map((c) => (c.id === activeThreadId ? { ...c, lastMessageAt: sent.createdAt } : c))),
        );
      } else if (activeType === 'DM' && setDms) {
        setDms((prev) =>
          sortDms(prev.map((d) => (d.id === activeThreadId ? { ...d, lastMessageAt: sent.createdAt } : d))),
        );
      }
    } catch (err) {
      console.error(err);
      setError?.('Unable to send message.');
    } finally {
      setSending(false);
    }
  }

  async function handleUploadAndSend(
    messages: CommunityMessage[],
    setMessages: React.Dispatch<React.SetStateAction<CommunityMessage[]>>,
    setChannels?: React.Dispatch<React.SetStateAction<any[]>>,
    setDms?: React.Dispatch<React.SetStateAction<any[]>>,
    setError?: (error: string) => void,
  ) {
    if (!activeThreadId || !token || selectedFiles.length === 0) return;
    setUploading(true);
    setError?.('');
    try {
      const attachmentIds: string[] = [];
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const formData = new FormData();
        formData.append('file', file);
        setUploadProgress(((i + 1) / selectedFiles.length) * 100);
        const uploaded = await api<{ fileUrl: string; fileName: string; fileSize: number; mimeType: string }>(
          '/community/upload',
          {
            method: 'POST',
            body: formData,
            headers: {},
          },
          token,
        );

        const attachmentPayload = {
          id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36),
          fileUrl: uploaded.fileUrl,
          fileName: uploaded.fileName,
          fileSize: uploaded.fileSize,
          mimeType: uploaded.mimeType,
        };

        attachmentIds.push(attachmentPayload.id);
      }
      const payload: { body: string; replyToMessageId?: string; attachmentIds?: string[] } = {
        body: draftMessage.trim() || 'Attachment',
        attachmentIds,
      };
      if (replyingTo) {
        payload.replyToMessageId = replyingTo.id;
      }
      const sent = await api<CommunityMessage>(
        `/community/threads/${activeThreadId}/messages`,
        { method: 'POST', body: JSON.stringify(payload) },
        token,
      );
      setMessages((prev) => dedupeMessages([...prev, sent]));
      setDraftMessage('');
      setReplyingTo(null);
      setSelectedFiles([]);
      setUploadProgress(0);
    } catch (err) {
      console.error(err);
      setError?.('Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  function handleTyping(wsRef: React.MutableRefObject<WebSocket | null>) {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    if (wsRef.current && wsRef.current.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'typing:start', threadId: activeThreadId }));
    }
    typingTimeoutRef.current = setTimeout(() => {
      if (wsRef.current && wsRef.current.readyState === 1) {
        wsRef.current.send(JSON.stringify({ type: 'typing:stop', threadId: activeThreadId }));
      }
    }, 3000);
  }

  async function handleReaction(messageId: string, emoji: string, messages: CommunityMessage[], setMessages: React.Dispatch<React.SetStateAction<CommunityMessage[]>>) {
    if (!token) return;
    try {
      const msg = messages.find((m) => m.id === messageId);
      const hasReacted = msg?.reactions?.some(
        (r) => r.emoji === emoji && r.userIds.includes(userId || ''),
      );
      if (hasReacted) {
        await api(`/community/messages/${messageId}/reactions/${emoji}`, { method: 'DELETE' }, token);
      } else {
        await api(
          `/community/messages/${messageId}/reactions`,
          {
            method: 'POST',
            body: JSON.stringify({ emoji }),
          },
          token,
        );
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handleEditMessage(messages: CommunityMessage[], setMessages: React.Dispatch<React.SetStateAction<CommunityMessage[]>>) {
    if (!editingMessage || !editDraft.trim() || !token) return;
    try {
      await api(
        `/community/messages/${editingMessage.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ body: editDraft.trim() }),
        },
        token,
      );
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === editingMessage.id
            ? { ...msg, body: editDraft.trim(), isEdited: true, editedAt: new Date().toISOString() }
            : msg,
        ),
      );
      setEditingMessage(null);
      setEditDraft('');
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDeleteMessage(messageId: string, messages: CommunityMessage[], setMessages: React.Dispatch<React.SetStateAction<CommunityMessage[]>>) {
    if (!token || !confirm('Delete this message?')) return;
    try {
      await api(`/community/messages/${messageId}`, { method: 'DELETE' }, token);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId ? { ...msg, isDeleted: true, deletedAt: new Date().toISOString() } : msg,
        ),
      );
    } catch (err) {
      console.error(err);
    }
  }

  async function handlePinMessage(messageId: string) {
    if (!token) return;
    try {
      await api(`/community/messages/${messageId}/pin`, { method: 'POST' }, token);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleUnpinMessage(messageId: string, setPinnedMessages: React.Dispatch<React.SetStateAction<any[]>>) {
    if (!token) return;
    try {
      await api(`/community/messages/${messageId}/pin`, { method: 'DELETE' }, token);
      setPinnedMessages((prev) => prev.filter((pin) => pin.messageId !== messageId));
    } catch (err) {
      console.error(err);
    }
  }

  function handleFileSelect(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    setSelectedFiles(files);
  }

  return {
    draftMessage,
    setDraftMessage,
    sending,
    replyingTo,
    setReplyingTo,
    editingMessage,
    setEditingMessage,
    editDraft,
    setEditDraft,
    uploading,
    uploadProgress,
    selectedFiles,
    setSelectedFiles,
    previewUrls,
    setPreviewUrls,
    handleSendMessage,
    handleTyping,
    handleReaction,
    handleEditMessage,
    handleDeleteMessage,
    handlePinMessage,
    handleUnpinMessage,
    handleFileSelect,
  };
}