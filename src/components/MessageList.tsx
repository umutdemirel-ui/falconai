import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ExternalLink, Loader2, ShieldAlert, User, X } from 'lucide-react';
import logo from '../../assets/falcon-mark.png';
import { api } from '../lib/api';
import { Markdown } from '../lib/markdown';
import { toolIcon } from '../lib/icons';
import type { ChatMessage } from '../../shared/types';
import { cn, formatTime, riskLabels } from '../lib/utils';

function FalconAvatar({ size = 26 }: { size?: number }) {
  return (
    <span
      className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-falcon-500/40 bg-black/80 shadow-[0_0_14px_-4px_rgba(255,47,47,0.8)]"
      style={{ width: size, height: size }}
    >
      <img src={logo} alt="" className="h-full w-full object-cover" draggable={false} />
    </span>
  );
}

function ToolCard({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const tool = message.tool;
  if (!tool) return null;
  const Icon = toolIcon(tool.name);
  const risk = riskLabels[tool.risk ?? 'safe'];
  const running = tool.status === 'running';

  return (
    <div className="flex gap-3">
      <FalconAvatar />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'overflow-hidden rounded-xl border bg-white/[0.025] transition-colors',
            running ? 'border-falcon-500/35 shadow-[0_0_26px_-16px_rgba(255,47,47,0.9)]' : 'border-white/[0.08]',
          )}
        >
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-white/[0.02]"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-falcon-500/25 bg-falcon-600/15 text-falcon-300">
              <Icon size={14} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-[12.5px] font-medium text-white/85">{tool.label}</span>
                {tool.agent && tool.agent !== 'Falcon' ? (
                  <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[9.5px] uppercase tracking-wider text-white/45">
                    {tool.agent}
                  </span>
                ) : null}
              </div>
              <p className="truncate text-[11px] text-white/40">{tool.detail || JSON.stringify(tool.args)}</p>
            </div>
            {running ? (
              <Loader2 size={14} className="animate-spin text-falcon-400" />
            ) : tool.status === 'ok' ? (
              <span className="flex items-center gap-1 text-[10.5px] font-medium text-emerald-300/90">
                <Check size={12} /> tamam
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10.5px] font-medium text-falcon-300">
                <X size={12} /> hata
              </span>
            )}
            <ChevronDown size={13} className={cn('text-white/25 transition-transform', open && 'rotate-180')} />
          </button>
          {open ? (
            <div className="border-t border-white/[0.06] px-3 py-2.5 text-[11px]">
              <div className="mb-1.5 flex items-center gap-2">
                <span className={cn('rounded border px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide', risk.className)}>{risk.label}</span>
                <span className="font-mono text-[10px] text-white/30">{tool.name}</span>
              </div>
              <pre className="whitespace-pre-wrap break-words font-mono text-[10.5px] leading-relaxed text-white/50">
                {JSON.stringify(tool.args, null, 2)}
              </pre>
              {tool.output ? (
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/50 p-2 font-mono text-[10.5px] leading-relaxed text-white/60">
                  {tool.output}
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AssistantMessage({ message, streaming }: { message: ChatMessage; streaming: boolean }) {
  return (
    <div className="flex gap-3">
      <FalconAvatar />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[12px] font-semibold text-white/85">Falcon</span>
          {message.agent && message.agent !== 'Falcon' ? (
            <span className="rounded border border-falcon-500/25 bg-falcon-600/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-falcon-200/80">
              {message.agent}
            </span>
          ) : null}
          <span className="text-[10px] text-white/25">{formatTime(message.createdAt)}</span>
          {message.error ? (
            <span className="flex items-center gap-1 text-[10px] text-falcon-300">
              <ShieldAlert size={11} /> hata
            </span>
          ) : null}
        </div>
        <div className={cn('rounded-2xl rounded-tl-md border border-white/[0.06] bg-white/[0.025] px-3.5 py-2.5', streaming && 'border-falcon-500/25')}>
          {message.text ? <Markdown text={message.text} /> : streaming ? <span className="caret text-white/40" /> : null}
          {streaming && message.text ? <span className="caret" /> : null}
        </div>
        {message.sources?.length ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {message.sources.slice(0, 4).map((src, i) => (
              <button
                key={i}
                type="button"
                onClick={() => void api.system.openUrl(src.uri)}
                className="flex max-w-[240px] items-center gap-1.5 rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-1 text-[10px] text-white/45 hover:text-falcon-200"
              >
                <ExternalLink size={10} className="shrink-0" />
                <span className="truncate">{src.title}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-end gap-3">
      <div className="flex max-w-[78%] flex-col items-end">
        <div className="rounded-2xl rounded-tr-md border border-falcon-500/30 bg-gradient-to-br from-falcon-600/25 to-falcon-900/20 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-white/90">
          <span className="whitespace-pre-wrap">{message.text}</span>
        </div>
        {message.attachments?.length ? (
          <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
            {message.attachments.map((att) => (
              <span key={att.id} className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[10.5px] text-white/50">
                {att.name}
              </span>
            ))}
          </div>
        ) : null}
        <span className="mt-1 flex items-center gap-1 text-[10px] text-white/25">
          <User size={10} /> {formatTime(message.createdAt)}
        </span>
      </div>
      <span className="mt-0.5 flex h-[26px] w-[26px] items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/40">
        <User size={13} />
      </span>
    </div>
  );
}

export function MessageList({ messages, busy }: { messages: ChatMessage[]; busy: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);
  const last = messages[messages.length - 1];

  useEffect(() => {
    if (!stick) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy, stick]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      setStick(nearBottom);
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div ref={scrollerRef} className="flex-1 space-y-4 overflow-y-auto px-1 py-2">
      {messages.map((message) => {
        if (message.role === 'user') return <UserMessage key={message.id} message={message} />;
        if (message.role === 'tool') return <ToolCard key={message.id} message={message} />;
        if (message.role === 'diary') {
          return (
            <div key={message.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11.5px] text-white/40">
              {message.text}
            </div>
          );
        }
        const streaming = busy && last?.id === message.id && message.role === 'assistant';
        return <AssistantMessage key={message.id} message={message} streaming={streaming} />;
      })}
      <div ref={bottomRef} />
    </div>
  );
}
