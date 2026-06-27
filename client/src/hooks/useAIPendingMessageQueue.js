import { useCallback, useEffect, useState } from 'react';

export const useAIPendingMessageQueue = () => {
  const [pendingImages, setPendingImages] = useState([]);
  const [pendingMessage, setPendingMessage] = useState(null);

  const addImageMessage = useCallback((dataUrl) => {
    if (!dataUrl) return;

    try {
      const match = typeof dataUrl === 'string'
        ? dataUrl.match(/^data:(.+);base64,/)
        : null;
      const mimeType = match ? match[1] : 'image/png';

      setPendingImages((prev) => [...prev, {
        type: 'inline',
        mimeType,
        dataUrl
      }]);
    } catch {
      // Ignore malformed clipboard payloads.
    }
  }, []);

  const queuePendingMessage = useCallback((text, images = []) => {
    setPendingMessage({ text, images });
    setPendingImages([]);
  }, []);

  return {
    pendingImages,
    setPendingImages,
    pendingMessage,
    setPendingMessage,
    addImageMessage,
    queuePendingMessage
  };
};

export const useQueuedAIMessageEffect = ({
  isLoading,
  pendingMessage,
  setPendingMessage,
  setPrompt,
  setPendingImages,
  generateAIResponse
}) => {
  useEffect(() => {
    if (isLoading || !pendingMessage) return undefined;

    const { text, images } = pendingMessage;
    setPendingMessage(null);
    setPrompt(text);
    if (images && images.length > 0) {
      setPendingImages(images);
    }

    const timer = setTimeout(() => {
      generateAIResponse(text);
    }, 100);

    return () => clearTimeout(timer);
  }, [
    generateAIResponse,
    isLoading,
    pendingMessage,
    setPendingImages,
    setPendingMessage,
    setPrompt
  ]);
};
