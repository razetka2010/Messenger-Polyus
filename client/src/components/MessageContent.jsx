import { useEffect, useRef, useState } from "react";
import { fetchAccountResource, getActiveAccountKey } from "../apiClient.mjs";
import { formatAttachmentSize } from "../attachmentFormatting.mjs";
import { decryptAttachment } from "../encryption.mjs";

let activeVoiceMessageAudio = null;

export function MessageText({ value }) {
  const pattern = /https?:\/\/[^\s<>"']+/giu;
  const parts = [];
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const raw = match[0];
    const href = raw.replace(/[),.!?;:]+$/g, "");
    if (match.index > cursor) parts.push(value.slice(cursor, match.index));
    parts.push(
      <a key={`${match.index}-${href}`} href={href} target="_blank" rel="noopener noreferrer">{href}</a>,
      raw.slice(href.length)
    );
    cursor = match.index + raw.length;
  }
  if (cursor < value.length) parts.push(value.slice(cursor));
  return parts.map((part, index) => (
    typeof part === "string" ? part.split("\n").flatMap((line, lineIndex) => (
      lineIndex === 0 ? [line] : [<br key={`${index}-${lineIndex}`} />, line]
    )) : part
  ));
}

function formatMediaTime(seconds) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

function VoiceMessagePlayer({ attachment, text, src }) {
  const audioRef = useRef(null);
  const playbackRequestedRef = useRef(false);
  const [playback, setPlayback] = useState({ playing: false, current: 0, duration: 0 });
  const bars = Array.from({ length: 36 }, (_, index) => 8 + ((index * 17 + index * index * 3) % 25));
  const progress = playback.duration ? playback.current / playback.duration : 0;
  useEffect(() => () => {
    const audio = audioRef.current;
    audio?.pause();
    if (activeVoiceMessageAudio === audio) activeVoiceMessageAudio = null;
  }, []);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (attachment.mimeType && audio.canPlayType(attachment.mimeType) === "") {
        document.dispatchEvent(new CustomEvent("polus:notify", {
          detail: text.unsupportedAudioFormat
        }));
        return;
      }
      if (activeVoiceMessageAudio && activeVoiceMessageAudio !== audio) {
        activeVoiceMessageAudio.pause();
      }
      activeVoiceMessageAudio = audio;
      playbackRequestedRef.current = true;
      try {
        await audio.play();
      } catch (error) {
        playbackRequestedRef.current = false;
        if (activeVoiceMessageAudio === audio) activeVoiceMessageAudio = null;
        console.error("Voice message playback failed:", error);
        document.dispatchEvent(new CustomEvent("polus:notify", {
          detail: text.playbackFailed
        }));
      }
    } else {
      audio.pause();
    }
  };

  return (
    <div className="voice-message-player">
      <audio
        ref={audioRef}
        src={src}
        preload="auto"
        onLoadedMetadata={(event) => {
          const duration = event.currentTarget.duration;
          setPlayback((current) => ({ ...current, duration }));
        }}
        onTimeUpdate={(event) => {
          const current = event.currentTarget.currentTime;
          setPlayback((playback) => ({ ...playback, current }));
        }}
        onPlaying={(event) => {
          const audio = event.currentTarget;
          playbackRequestedRef.current = false;
          if (activeVoiceMessageAudio && activeVoiceMessageAudio !== audio) {
            audio.pause();
            return;
          }
          activeVoiceMessageAudio = audio;
          setPlayback((current) => ({ ...current, playing: true }));
        }}
        onPause={(event) => {
          playbackRequestedRef.current = false;
          if (activeVoiceMessageAudio === event.currentTarget) activeVoiceMessageAudio = null;
          setPlayback((current) => ({ ...current, playing: false }));
        }}
        onEnded={(event) => {
          playbackRequestedRef.current = false;
          if (activeVoiceMessageAudio === event.currentTarget) activeVoiceMessageAudio = null;
          setPlayback((current) => ({ ...current, playing: false, current: 0 }));
        }}
        onError={() => {
          if (!playbackRequestedRef.current) return;
          playbackRequestedRef.current = false;
          if (activeVoiceMessageAudio === audioRef.current) activeVoiceMessageAudio = null;
          setPlayback((current) => ({ ...current, playing: false }));
          document.dispatchEvent(new CustomEvent("polus:notify", {
            detail: text.unsupportedAudioFormat
          }));
        }}
      />
      <button
        type="button"
        className="voice-message-play"
        aria-label={playback.playing ? text.pause : text.play}
        title={playback.playing ? text.pause : text.play}
        onClick={() => void togglePlayback()}
      >
        {playback.playing
          ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h3v14H8zM15 5h3v14h-3z" /></svg>
          : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z" /></svg>}
      </button>
      <div className={`voice-message-wave${playback.playing ? " is-playing" : ""}`} aria-hidden="true">
        {bars.map((height, index) => (
          <span
            key={index}
            className={index / bars.length <= progress ? "is-played" : ""}
            style={{ "--wave-height": `${height}%`, "--wave-delay": `${(index % 9) * -0.11}s` }}
          />
        ))}
      </div>
      <span className="voice-message-time">{formatMediaTime(playback.playing ? playback.current : playback.duration)}</span>
    </div>
  );
}

function useAttachmentUrl(attachment) {
  const [url, setUrl] = useState("");
  const accountKey = getActiveAccountKey();
  useEffect(() => {
    let active = true;
    let objectUrl = null;
    setUrl("");
    const resource = attachment.encrypted
      ? decryptAttachment(attachment, accountKey)
      : fetchAccountResource(
        attachment.thumbnailUrl || `/api/attachments/${encodeURIComponent(attachment.id)}`,
        accountKey
      );
    resource.then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch((error) => {
      console.error("Unable to load message attachment:", error);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment, accountKey]);
  return url;
}

export function MessageAttachment({ attachment, text, mediaType }) {
  const url = useAttachmentUrl(attachment);
  const image = attachment.mimeType?.startsWith("image/");
  const media = image || /^(audio|video)\//.test(attachment.mimeType || "");
  if (!url) return <div className="message-attachment" aria-busy="true">...</div>;
  if (mediaType === "voice") return <VoiceMessagePlayer attachment={attachment} text={text} src={url} />;

  return (
    <div className="message-attachment">
      {image && (
        <img
          className="message-attachment-image"
          src={url}
          alt={attachment.name}
          loading="lazy"
          onClick={() => document.dispatchEvent(new CustomEvent("polus:open-media", {
            detail: { attachmentId: attachment.id, attachment, decryptedUrl: url }
          }))}
        />
      )}
      {!image && /^(audio|video)\//.test(attachment.mimeType || "") && (
        attachment.mimeType.startsWith("audio/")
          ? <audio controls preload="metadata" src={url} />
          : <video controls preload="metadata" src={url} />
      )}
      <a className="file-card" href={url} download={attachment.name}>
        <span className="file-card-icon">{media ? "▧" : "↧"}</span>
        <span className="file-card-details">
          <strong>{attachment.name}</strong>
          <small>{formatAttachmentSize(attachment.size)}</small>
        </span>
        <span className="file-card-download">{text.download}</span>
      </a>
    </div>
  );
}
