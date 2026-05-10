import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { SendHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

const maxHeight = 240;

export function ChatInput({
  onSend,
  disabled = false,
  placeholder = 'Message the agent...',
}: ChatInputProps) {
  const [content, setContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const resizeTextarea = () => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  };

  useEffect(() => {
    resizeTextarea();
  }, [content]);

  const handleSend = () => {
    const nextContent = content.trim();
    if (!nextContent || disabled) {
      return;
    }

    onSend(nextContent);
    setContent('');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    handleSend();
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <Textarea
        className="max-h-60 min-h-24 w-full resize-none text-sm sm:min-h-20"
        disabled={disabled}
        onChange={(event) => setContent(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        ref={textareaRef}
        rows={1}
        value={content}
      />
      <Button
        className="min-h-11 w-full px-4 sm:w-auto"
        disabled={disabled || !content.trim()}
        onClick={handleSend}
        type="button"
      >
        <SendHorizontal />
        Send
      </Button>
    </div>
  );
}
