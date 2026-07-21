import React from 'react';
import type { Bubble } from '../types';

interface SpeechBubbleProps {
  bubble: Bubble;
}

/** Floating line shown above an agent. Color is keyed off the bubble kind. */
function SpeechBubbleBase({ bubble }: SpeechBubbleProps) {
  return (
    <div className={`av-bubble av-bubble--${bubble.kind}`} role="status">
      <span className="av-bubble__text">{bubble.text}</span>
      <span className="av-bubble__tail" aria-hidden />
    </div>
  );
}

export const SpeechBubble = React.memo(SpeechBubbleBase);
