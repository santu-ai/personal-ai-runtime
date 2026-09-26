import { useState, useRef, useCallback } from "react";
import { Mic, MicOff } from "lucide-react";

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

interface SpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: SpeechRecognitionErrorEvent) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  [index: number]: SpeechRecognitionResult;
  length: number;
}

interface SpeechRecognitionResult {
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
  length: number;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

function getSpeechRecognition(): SpeechRecognition | null {
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionCtor) return null;
  const rec = new SpeechRecognitionCtor();
  rec.continuous = false;
  rec.interimResults = true;
  rec.lang = "zh-CN";
  return rec;
}

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

export default function VoiceInput({ onTranscript, disabled }: VoiceInputProps) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [interimText, setInterimText] = useState("");
  const recRef = useRef<SpeechRecognition | null>(null);

  const startListening = useCallback(() => {
    const rec = getSpeechRecognition();
    if (!rec) {
      setIsSupported(false);
      return;
    }
    recRef.current = rec;
    rec.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = "";
      let interimTranscript = "";
      for (let i = event.results.length - 1; i >= 0; i--) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript = result[0].transcript + finalTranscript;
        } else {
          interimTranscript = result[0].transcript + interimTranscript;
        }
      }
      setInterimText(interimTranscript);
      if (finalTranscript) {
        onTranscript(finalTranscript.trim());
        rec.stop();
      }
    };
    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      setIsListening(false);
      if (e.error === "not-allowed") setIsSupported(false);
    };
    rec.onend = () => {
      setIsListening(false);
      setInterimText("");
    };
    try {
      rec.start();
      setIsListening(true);
    } catch {
      setIsSupported(false);
    }
  }, [onTranscript]);

  const stopListening = useCallback(() => {
    recRef.current?.abort();
    setIsListening(false);
    setInterimText("");
  }, []);

  if (!isSupported) return null;

  const voiceLabel = isListening ? "停止录音" : "语音输入";

  return (
    <div className="group/voice flex items-center gap-1">
      {interimText && (
        // 平时截短，整句在悬停 title 里。键盘落到麦克风时写出整句。鼠标点上去仍是截短的。
        <span
          title={interimText}
          className="max-w-40 truncate text-xs text-fg-secondary animate-pulse group-has-[:focus-visible]/voice:max-w-none group-has-[:focus-visible]/voice:overflow-visible group-has-[:focus-visible]/voice:whitespace-normal group-has-[:focus-visible]/voice:text-clip group-has-[:focus-visible]/voice:break-words"
        >
          {interimText}
        </span>
      )}
      <button
        type="button"
        onClick={isListening ? stopListening : startListening}
        disabled={disabled}
        aria-label={voiceLabel}
        title={voiceLabel}
        className={`group inline-flex max-w-full items-center justify-center p-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
          isListening
            ? "bg-danger/15 text-danger hover:bg-danger/25"
            : "text-fg-tertiary hover:text-fg-primary hover:bg-surface-overlay"
        } disabled:opacity-30`}
      >
        {isListening ? (
          <MicOff size={16} className="shrink-0 group-focus-visible:hidden" aria-hidden />
        ) : (
          <Mic size={16} className="shrink-0 group-focus-visible:hidden" aria-hidden />
        )}
        <span
          data-voice-name=""
          className="hidden whitespace-nowrap text-center text-[10px] leading-tight group-focus-visible:block"
        >
          {voiceLabel}
        </span>
      </button>
    </div>
  );
}
