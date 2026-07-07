import { FormEvent, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PROFILE_MENU, WEB_HEADER_MENUS, type WebMenuId } from "./model/navigation";
import type { Agent } from "../entities/agent/model/types";
import { fetchCharacter, updateCharacter, type CharacterUpsertBody } from "../entities/agent/api/characterApi";
import { fetchAgents } from "../entities/agent/api/agentApi";
import { FALLBACK_AGENTS, starterPrompts } from "../entities/agent/model/defaultAgents";
import { sendChat, streamChat, transcribeAudio } from "../entities/chat/api/chatApi";
import type { ChatTurn, Message } from "../entities/chat/model/types";
import {
  deleteOpenAiApiKey,
  getOpenAiApiKey,
  saveOpenAiApiKey,
  validateOpenAiApiKey,
  validateOpenAiApiKeyDraft,
  type OpenAiApiKeyResponse,
  type OpenAiApiKeyValidationResponse,
} from "../entities/user/api/userApiKeyApi";
import { defaultApiUrl, unauthorizedEventName } from "../shared/api/client";
import { EnglishConversationView } from "../pages/english-conversation/ui/EnglishConversationView";
import { readImage } from "../shared/lib/file";
import { hasKorean, normalizeReply } from "../shared/lib/format";
import { CircleAlert, CheckCircle2, Download, KeyRound, Loader2, Mail, RefreshCw, Settings as SettingsIcon, ShieldCheck, UserCircle } from "lucide-react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { login, logout, signup } from "../features/auth/api/authApi";
import { LoginScreen } from "../features/auth/login/LoginScreen";
import { useAuthSession } from "../features/auth/model/useAuthSession";
import { AppSidebar } from "../widgets/app-shell/ui/AppSidebar";
import { AppTopbar } from "../widgets/app-shell/ui/AppTopbar";
import { useAppUpdate } from "../shared/lib/useAppUpdate";
import { AppUpdatePanel } from "../shared/ui/AppUpdatePanel";

const appVersion = "0.1.15";
const voiceRecordLimitMs = 8_000;
type AppUpdateControls = ReturnType<typeof useAppUpdate>;

type CharacterEditorDraft = {
  title: string;
  subtitle: string;
  description: string;
  level: string;
  sessionGoal: string;
  skillsText: string;
  starterPromptsText: string;
  style: string;
  scenario: string;
  character: string;
  knowledge: string;
  news: string;
  schedule: string;
};

function createId() {
  return crypto.randomUUID();
}

export function App() {
  const apiUrl = defaultApiUrl;
  const { token, user, setToken, setRefreshToken, setUser } = useAuthSession();
  const [agents, setAgents] = useState<Agent[]>(FALLBACK_AGENTS);
  const [selectedAgentId, setSelectedAgentId] = useState("debate");
  const [characterDetailOpen, setCharacterDetailOpen] = useState(false);
  const [characterDetailLoading, setCharacterDetailLoading] = useState(false);
  const [characterDetailError, setCharacterDetailError] = useState("");
  const [characterDetailDraft, setCharacterDetailDraft] = useState<CharacterEditorDraft | null>(null);
  const [characterEditorOpen, setCharacterEditorOpen] = useState(false);
  const [characterEditorLoading, setCharacterEditorLoading] = useState(false);
  const [characterEditorSaving, setCharacterEditorSaving] = useState(false);
  const [characterEditorError, setCharacterEditorError] = useState("");
  const [characterEditorDraft, setCharacterEditorDraft] = useState<CharacterEditorDraft | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [image, setImage] = useState<{ name: string; dataUrl: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"checking" | "online" | "offline">("checking");
  const [autoTranslate, setAutoTranslate] = useState(true);
  const [responseLength, setResponseLength] = useState<"1-3" | "3-4" | "4-5">("1-3");
  const [sidebarTab, setSidebarTab] = useState<"suggestions" | "questions" | "koen" | "history">("suggestions");
  const [draftKo, setDraftKo] = useState("");
  const [voiceTarget, setVoiceTarget] = useState<"input" | "draft" | null>(null);
  const [voicePhase, setVoicePhase] = useState<"idle" | "recording" | "transcribing">("idle");
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [suggestedReplies, setSuggestedReplies] = useState<string[]>([]);
  const [suggestingReplies, setSuggestingReplies] = useState(false);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [suggestedQuestionCount, setSuggestedQuestionCount] = useState<3 | 5 | 10 | 20>(5);
  const [suggestingQuestions, setSuggestingQuestions] = useState(false);
  const [history, setHistory] = useState<Message[][]>([]);
  const [error, setError] = useState("");
  const [activeMenu, setActiveMenu] = useState<WebMenuId>("englishConversation");
  const appUpdate = useAppUpdate(appVersion);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceStopTimerRef = useRef<number | null>(null);
  const voiceAudioContextRef = useRef<AudioContext | null>(null);
  const voiceMeterFrameRef = useRef<number | null>(null);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? FALLBACK_AGENTS[0],
    [agents, selectedAgentId]
  );
  const selectedAgentEditable = /^\d+$/.test(selectedAgent.id);
  const activeWebMenu = useMemo(
    () => [...WEB_HEADER_MENUS, PROFILE_MENU].find((menu) => menu.id === activeMenu) ?? WEB_HEADER_MENUS[0],
    [activeMenu]
  );
  const isLoggedIn = token.trim().length > 0 && user !== null;

  useEffect(() => {
    if (isLoggedIn) appUpdate.checkOnceOnStartup();
  }, [appUpdate.checkOnceOnStartup, isLoggedIn]);

  useEffect(() => {
    const clearExpiredSession = () => {
      setToken("");
      setRefreshToken("");
      setUser(null);
      setError("");
      setActiveMenu("englishConversation");
    };

    window.addEventListener(unauthorizedEventName, clearExpiredSession);
    return () => window.removeEventListener(unauthorizedEventName, clearExpiredSession);
  }, [setRefreshToken, setToken, setUser]);

  useEffect(() => {
    if (!isLoggedIn) {
      setAgents(FALLBACK_AGENTS);
      return;
    }

    let cancelled = false;
    setConnectionStatus("checking");
    fetchAgents(apiUrl, token)
      .then((data) => {
        if (cancelled) return;
        if (data.length > 0) {
          setAgents(data);
          setSelectedAgentId((current) => data.some((agent) => agent.id === current) ? current : data[0].id);
        }
        setConnectionStatus("online");
        setError("");
      })
      .catch(() => {
        if (cancelled) return;
        setConnectionStatus("offline");
        setAgents(FALLBACK_AGENTS);
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, isLoggedIn, token]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  useEffect(() => {
    return () => {
      if (voiceStopTimerRef.current !== null) window.clearTimeout(voiceStopTimerRef.current);
      stopVoiceMeter();
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const sendMessage = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = input.trim();
    if ((!text && !image) || sending) return;

    const learnerMessage: Message = {
      id: createId(),
      role: "learner",
      text: text || "Please look at this image.",
      imageUrl: image?.dataUrl,
    };
    const agentMessageId = createId();
    const historyTurns: ChatTurn[] = messages.slice(-12).map((message) => ({
      role: message.role === "agent" ? "assistant" : "user",
      content: message.text,
    }));

    setMessages((current) => [
      ...current,
      learnerMessage,
      { id: agentMessageId, role: "agent", text: "", streaming: true },
    ]);
    setInput("");
    setImage(null);
    setSending(true);
    setError("");

    try {
      const body = {
        agentId: selectedAgent.id,
        message: text || "Please look at the attached image and respond naturally.",
        instructions: [
          `Keep replies to ${responseLength} sentences.`,
          "Write like natural spoken conversation. Avoid em dashes, double hyphens, markdown bullets, and decorative punctuation.",
          autoTranslate ? "If useful, keep English simple for a Korean learner." : "",
        ].filter(Boolean).join("\n"),
        history: historyTurns,
        images: image ? [{ dataUrl: image.dataUrl }] : undefined,
      };

      if (image) {
        const data = await sendChat(apiUrl, token, body);
        const reply = normalizeReply(data.content);
        setMessages((current) =>
          current.map((message) =>
            message.id === agentMessageId ? { ...message, text: reply, streaming: false } : message
          )
        );
      } else {
        const responseText = await streamChat(apiUrl, token, body, (data) => {
            setMessages((current) =>
              current.map((message) =>
                message.id === agentMessageId ? { ...message, text: message.text + data } : message
              )
            );
        });
        const reply = normalizeReply(responseText);
        setMessages((current) =>
          current.map((message) =>
            message.id === agentMessageId ? { ...message, text: reply, streaming: false } : message
          )
        );
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "unknown error";
      setError(`백엔드 연결 또는 인증을 확인하세요. ${message}`);
      setMessages((current) =>
        current.map((item) =>
          item.id === agentMessageId
            ? {
                ...item,
                streaming: false,
                text: "I could not connect to the English Agent Hub server. Please check the backend server and your login session.",
              }
            : item
        )
      );
    } finally {
      setSending(false);
    }
  };

  const saveSession = () => {
    if (messages.length === 0) return;
    setHistory((current) => [messages, ...current].slice(0, 8));
  };

  const characterDetailToDraft = (detail: {
    title: string;
    subtitle?: string;
    description?: string;
    level?: string;
    sessionGoal?: string;
    skills?: string[];
    starterPrompts?: string[];
    style?: string;
    scenario?: string;
    character?: string;
    knowledge?: string;
    news?: string;
    schedule?: string;
  }): CharacterEditorDraft => ({
    title: detail.title ?? "",
    subtitle: detail.subtitle ?? "",
    description: detail.description ?? "",
    level: detail.level ?? "",
    sessionGoal: detail.sessionGoal ?? "",
    skillsText: (detail.skills ?? []).join(", "),
    starterPromptsText: (detail.starterPrompts ?? []).join("\n"),
    style: detail.style ?? "",
    scenario: detail.scenario ?? "",
    character: detail.character ?? "",
    knowledge: detail.knowledge ?? "",
    news: detail.news ?? "",
    schedule: detail.schedule ?? "",
  });

  const openCharacterEditor = async () => {
    if (!selectedAgentEditable || characterEditorLoading) return;
    setCharacterDetailOpen(false);
    setCharacterEditorOpen(true);
    setCharacterEditorLoading(true);
    setCharacterEditorError("");
    setCharacterEditorDraft(characterDetailToDraft(selectedAgent));
    try {
      const detail = await fetchCharacter(apiUrl, token, selectedAgent.id);
      setCharacterEditorDraft(characterDetailToDraft(detail));
    } catch (caught) {
      setCharacterEditorError(caught instanceof Error ? caught.message : "캐릭터 정보를 불러오지 못했습니다.");
    } finally {
      setCharacterEditorLoading(false);
    }
  };

  const openCharacterDetail = async (agentId = selectedAgent.id) => {
    if (characterDetailLoading) return;
    const targetAgent = agents.find((agent) => agent.id === agentId) ?? selectedAgent;
    const targetEditable = /^\d+$/.test(targetAgent.id);
    setSelectedAgentId(targetAgent.id);
    setCharacterDetailOpen(true);
    setCharacterDetailError("");
    setCharacterDetailDraft(characterDetailToDraft(targetAgent));
    if (!targetEditable) return;

    setCharacterDetailLoading(true);
    try {
      const detail = await fetchCharacter(apiUrl, token, targetAgent.id);
      setCharacterDetailDraft(characterDetailToDraft(detail));
    } catch (caught) {
      setCharacterDetailError(caught instanceof Error ? caught.message : "캐릭터 정보를 불러오지 못했습니다.");
    } finally {
      setCharacterDetailLoading(false);
    }
  };

  const closeCharacterDetail = () => {
    setCharacterDetailOpen(false);
    setCharacterDetailError("");
  };

  const closeCharacterEditor = () => {
    if (characterEditorSaving) return;
    setCharacterEditorOpen(false);
    setCharacterEditorError("");
  };

  const parseListText = (value: string) =>
    value
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);

  const saveCharacterEditor = async () => {
    if (!selectedAgentEditable || !characterEditorDraft || characterEditorSaving) return;
    const title = characterEditorDraft.title.trim();
    if (!title) {
      setCharacterEditorError("캐릭터 이름은 필수입니다.");
      return;
    }

    const body: CharacterUpsertBody = {
      title,
      subtitle: characterEditorDraft.subtitle.trim() || undefined,
      description: characterEditorDraft.description.trim() || undefined,
      level: characterEditorDraft.level.trim() || undefined,
      sessionGoal: characterEditorDraft.sessionGoal.trim() || undefined,
      skills: parseListText(characterEditorDraft.skillsText),
      starterPrompts: parseListText(characterEditorDraft.starterPromptsText),
      style: characterEditorDraft.style.trim() || undefined,
      scenario: characterEditorDraft.scenario.trim() || undefined,
      character: characterEditorDraft.character.trim() || undefined,
      knowledge: characterEditorDraft.knowledge.trim() || undefined,
      news: characterEditorDraft.news.trim() || undefined,
      schedule: characterEditorDraft.schedule.trim() || undefined,
    };

    setCharacterEditorSaving(true);
    setCharacterEditorError("");
    try {
      const updated = await updateCharacter(apiUrl, token, selectedAgent.id, body);
      setAgents((current) =>
        current.map((agent) =>
          agent.id === selectedAgent.id
            ? {
                ...agent,
                title: updated.title,
                subtitle: updated.subtitle,
                description: updated.description,
                sessionGoal: updated.sessionGoal,
              }
            : agent
        )
      );
      setCharacterEditorDraft(characterDetailToDraft(updated));
      setCharacterEditorOpen(false);
    } catch (caught) {
      setCharacterEditorError(caught instanceof Error ? caught.message : "캐릭터 저장에 실패했습니다.");
    } finally {
      setCharacterEditorSaving(false);
    }
  };

  const extractSuggestions = (content: string, key: "replies" | "questions", limit: number) => {
    const cleaned = normalizeReply(content);
    try {
      const parsed = JSON.parse(cleaned) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, limit);
      }
      if (parsed && typeof parsed === "object" && key in parsed) {
        const values = (parsed as Record<string, unknown>)[key];
        if (Array.isArray(values)) {
          return values.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, limit);
        }
      }
    } catch {
      // Fall back to line parsing below.
    }
    return cleaned
      .split(/\n+/)
      .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
      .filter(Boolean)
      .slice(0, limit);
  };

  const buildSuggestedReplies = async () => {
    if (suggestingReplies) return;
    setSidebarTab("suggestions");
    setSuggestingReplies(true);
    setError("");

    const recentMessages = messages.slice(-5);
    const historyTurns: ChatTurn[] = recentMessages.map((message) => ({
      role: message.role === "agent" ? "assistant" : "user",
      content: message.text,
    }));
    const lastAgentMessage = [...messages].reverse().find((message) => message.role === "agent" && message.text.trim());
    const fallback = [
      "That sounds interesting. Can you tell me a little more about it?",
      "I see what you mean. I think I would feel the same way.",
      "Actually, I had a similar experience recently.",
    ];

    try {
      const data = await sendChat(apiUrl, token, {
        agentId: selectedAgent.id,
        message: [
          "Create exactly 3 natural learner replies for the next turn in this English conversation.",
          "Use the recent conversation context. Each reply should be casual, useful, and 1 sentence.",
          "Return only JSON in this shape: {\"replies\":[\"...\",\"...\",\"...\"]}.",
          lastAgentMessage ? `The latest assistant message is: ${lastAgentMessage.text}` : "There is no conversation yet, so suggest friendly opening replies.",
        ].join("\n"),
        instructions: "You are helping a Korean English learner choose a natural next reply. Keep the replies easy to say aloud.",
        history: historyTurns,
      });
      const replies = extractSuggestions(data.content, "replies", 3);
      setSuggestedReplies(replies.length > 0 ? replies : fallback);
    } catch (caught) {
      setSuggestedReplies(fallback);
      setError(caught instanceof Error ? `추천 답변 생성에 실패해 기본 예시를 표시했습니다. ${caught.message}` : "추천 답변 생성에 실패해 기본 예시를 표시했습니다.");
    } finally {
      setSuggestingReplies(false);
    }
  };

  const buildSuggestedQuestions = async (count = suggestedQuestionCount) => {
    if (suggestingQuestions) return;
    setSidebarTab("questions");
    setSuggestedQuestionCount(count);
    setSuggestingQuestions(true);
    setError("");

    const fallback = [
      "What do you usually do after work or school?",
      "What kind of food do you like these days?",
      "Can you tell me about your weekend plans?",
      "What is something interesting that happened recently?",
      "What do you like most about living in the U.S.?",
      "How do you usually spend time with friends?",
      "What hobby would you recommend to me?",
      "What is one place in your city I should visit?",
      "How do you relax when you feel tired?",
      "What kind of music or movies do you enjoy?",
      "What was your favorite trip?",
      "What do you usually talk about with close friends?",
      "What is something you want to learn this year?",
      "Can you describe your neighborhood?",
      "What is a normal weekday like for you?",
      "What do people your age do for fun?",
      "What is a small goal you have this month?",
      "What is your favorite season and why?",
      "How do you stay healthy?",
      "What is one thing that surprised you recently?",
    ].slice(0, count);

    try {
      const data = await sendChat(apiUrl, token, {
        agentId: selectedAgent.id,
        message: [
          `Create exactly ${count} natural conversation questions the learner can ask this character.`,
          "Use the character's role, style, session goal, and known context.",
          "Each question should be one sentence, easy for a Korean English learner to say, and useful for starting or continuing conversation.",
          `Return only JSON in this shape: {"questions":["..."]}.`,
        ].join("\n"),
        instructions: [
          "You generate learner questions, not answers.",
          `Character title: ${selectedAgent.title}`,
          selectedAgent.subtitle ? `Subtitle: ${selectedAgent.subtitle}` : "",
          selectedAgent.description ? `Description: ${selectedAgent.description}` : "",
          selectedAgent.sessionGoal ? `Session goal: ${selectedAgent.sessionGoal}` : "",
          selectedAgent.systemPrompt ? `System prompt: ${selectedAgent.systemPrompt}` : "",
        ].filter(Boolean).join("\n"),
        history: [],
      });
      const questions = extractSuggestions(data.content, "questions", count);
      setSuggestedQuestions(questions.length > 0 ? questions : fallback);
    } catch (caught) {
      setSuggestedQuestions(fallback);
      setError(caught instanceof Error ? `추천 질문 생성에 실패해 기본 예시를 표시했습니다. ${caught.message}` : "추천 질문 생성에 실패해 기본 예시를 표시했습니다.");
    } finally {
      setSuggestingQuestions(false);
    }
  };

  const buildFeedback = () => {
    const source = draftKo.trim() || input.trim();
    if (!source) return;
    setSidebarTab("suggestions");
    if (hasKorean(source)) {
      setSuggestedReplies([
        "Could you say that again in a simpler way?",
        "What do you mean by that?",
        "I want to explain it more naturally in English.",
      ]);
    } else {
      setSuggestedReplies([
        source.replace(/\s*[—–]\s*/g, ", "),
        "That sounds natural. You can say it a little more casually.",
        "Try making it shorter for conversation.",
      ]);
    }
  };

  const clearVoiceStopTimer = () => {
    if (voiceStopTimerRef.current === null) return;
    window.clearTimeout(voiceStopTimerRef.current);
    voiceStopTimerRef.current = null;
  };

  const stopVoiceMeter = () => {
    if (voiceMeterFrameRef.current !== null) {
      window.cancelAnimationFrame(voiceMeterFrameRef.current);
      voiceMeterFrameRef.current = null;
    }
    const audioContext = voiceAudioContextRef.current;
    voiceAudioContextRef.current = null;
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close();
    }
    setVoiceLevel(0);
  };

  const startVoiceMeter = (stream: MediaStream) => {
    stopVoiceMeter();
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    voiceAudioContextRef.current = audioContext;

    const samples = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const centered = (sample - 128) / 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / samples.length);
      setVoiceLevel(Math.min(1, rms * 4));
      voiceMeterFrameRef.current = window.requestAnimationFrame(tick);
    };
    tick();
  };

  const stopVoiceInput = () => {
    clearVoiceStopTimer();
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }
    setVoiceTarget(null);
    setVoicePhase("idle");
  };

  const createAudioRecorder = (stream: MediaStream) => {
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac"];
    const mimeType =
      typeof MediaRecorder.isTypeSupported === "function"
        ? candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate))
        : undefined;
    return new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  };

  const appendVoiceText = (target: "input" | "draft", text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const append = (current: string) => (current.trim() ? `${current.trim()} ${trimmed}` : trimmed);
    if (target === "input") setInput(append);
    else setDraftKo(append);
  };

  const toggleVoiceInput = async (target: "input" | "draft") => {
    if (voiceTarget === target) {
      if (voicePhase === "transcribing") return;
      stopVoiceInput();
      return;
    }
    if (voiceTarget !== null) return;
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("현재 환경에서 음성 녹음을 지원하지 않습니다.");
      return;
    }

    setError("");
    setVoiceTarget(target);
    setVoicePhase("recording");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      startVoiceMeter(stream);
      const recorder = createAudioRecorder(stream);
      mediaRecorderRef.current = recorder;
      voiceStreamRef.current = stream;
      voiceChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) voiceChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setError("음성 녹음 중 오류가 발생했습니다.");
        clearVoiceStopTimer();
        stopVoiceMeter();
        voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
        voiceStreamRef.current = null;
        mediaRecorderRef.current = null;
        voiceChunksRef.current = [];
        setVoiceTarget(null);
        setVoicePhase("idle");
      };
      recorder.onstop = async () => {
        clearVoiceStopTimer();
        stopVoiceMeter();
        const blob = new Blob(voiceChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
        voiceStreamRef.current = null;
        mediaRecorderRef.current = null;
        voiceChunksRef.current = [];

        if (blob.size === 0) {
          setVoiceTarget(null);
          setVoicePhase("idle");
          return;
        }

        setVoicePhase("transcribing");
        try {
          const { text } = await transcribeAudio(apiUrl, token, blob, target === "input" ? "en" : undefined);
          appendVoiceText(target, text);
        } catch (caught) {
          const message =
            caught instanceof Error && caught.name === "AbortError"
              ? "요청 시간이 초과되었습니다."
              : caught instanceof Error
                ? caught.message
                : "unknown error";
          setError(`음성 인식에 실패했습니다. ${message}`);
        } finally {
          setVoiceTarget(null);
          setVoicePhase("idle");
        }
      };
      recorder.start();
      voiceStopTimerRef.current = window.setTimeout(() => stopVoiceInput(), voiceRecordLimitMs);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "마이크 권한을 확인하세요.";
      clearVoiceStopTimer();
      stopVoiceMeter();
      voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
      voiceStreamRef.current = null;
      mediaRecorderRef.current = null;
      voiceChunksRef.current = [];
      setVoiceTarget(null);
      setVoicePhase("idle");
      setError(`마이크를 사용할 수 없습니다. ${message}`);
    }
  };

  const openMenu = (menu: WebMenuId) => {
    setActiveMenu(menu);
  };

  const handleLogin = async (email: string, password: string) => {
    const data = await login(apiUrl, email, password);
    setToken(data.accessToken);
    setRefreshToken(data.refreshToken);
    setUser(data.user);
    setActiveMenu("englishConversation");
  };

  const handleSignup = async (email: string, username: string, password: string) => {
    await signup(apiUrl, email, username, password);
  };

  const handleLogout = async () => {
    await logout(apiUrl, token);
    setToken("");
    setRefreshToken("");
    setUser(null);
  };

  const attachImageFile = async (file: File | null | undefined) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
      setError("PNG, JPG, WebP, GIF 이미지만 첨부할 수 있습니다.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("이미지는 5MB보다 작아야 합니다.");
      return;
    }
    setImage({ name: file.name, dataUrl: await readImage(file) });
    if (fileRef.current) fileRef.current.value = "";
  };

  const attachImage = async (files: FileList | null) => {
    await attachImageFile(files?.[0]);
  };

  if (!isLoggedIn) {
    return (
      <LoginScreen
        onLogin={handleLogin}
        onSignup={handleSignup}
      />
    );
  }

  return (
    <main className="app-shell">
      <AppSidebar
        menus={WEB_HEADER_MENUS}
        activeMenu={activeMenu}
        activeWebMenu={activeWebMenu}
        user={user}
        connectionStatus={connectionStatus}
        appVersion={appUpdate.state.currentVersion}
        updateState={appUpdate.state}
        updateBusy={appUpdate.busy}
        onOpenMenu={openMenu}
        onInstallUpdate={() => void appUpdate.installUpdate()}
        onLogout={() => void handleLogout()}
      />

      <div className="app-content">
        <AppTopbar
          activeMenu={activeMenu}
          activeWebMenu={activeWebMenu}
          selectedAgent={selectedAgent}
        />

        {activeMenu === "englishConversation" && (
          <EnglishConversationView
            agents={agents}
            selectedAgent={selectedAgent}
            selectedAgentId={selectedAgentId}
            selectedAgentEditable={selectedAgentEditable}
            characterDetailOpen={characterDetailOpen}
            characterDetailLoading={characterDetailLoading}
            characterDetailError={characterDetailError}
            characterDetailDraft={characterDetailDraft}
            characterEditorOpen={characterEditorOpen}
            characterEditorLoading={characterEditorLoading}
            characterEditorSaving={characterEditorSaving}
            characterEditorError={characterEditorError}
            characterEditorDraft={characterEditorDraft}
            messages={messages}
            input={input}
            image={image}
            sending={sending}
            connectionStatus={connectionStatus}
            autoTranslate={autoTranslate}
            responseLength={responseLength}
            sidebarTab={sidebarTab}
            draftKo={draftKo}
            suggestedReplies={suggestedReplies}
            suggestingReplies={suggestingReplies}
            suggestedQuestions={suggestedQuestions}
            suggestedQuestionCount={suggestedQuestionCount}
            suggestingQuestions={suggestingQuestions}
            history={history}
            error={error}
            voiceTarget={voiceTarget}
            voicePhase={voicePhase}
            voiceLevel={voiceLevel}
            user={user}
            starterPrompts={starterPrompts}
            fileRef={fileRef}
            endRef={endRef}
            onSelectAgent={setSelectedAgentId}
            onOpenCharacterDetail={(agentId) => void openCharacterDetail(agentId)}
            onCloseCharacterDetail={closeCharacterDetail}
            onOpenCharacterEditor={() => void openCharacterEditor()}
            onCloseCharacterEditor={closeCharacterEditor}
            onSetCharacterEditorDraft={setCharacterEditorDraft}
            onSaveCharacterEditor={() => void saveCharacterEditor()}
            onSetInput={setInput}
            onSetImage={setImage}
            onSetAutoTranslate={setAutoTranslate}
            onSetResponseLength={setResponseLength}
            onSetSidebarTab={setSidebarTab}
            onSetDraftKo={setDraftKo}
            onSetMessages={setMessages}
            onSendMessage={sendMessage}
            onAttachImage={(files) => void attachImage(files)}
            onPasteImage={(file) => void attachImageFile(file)}
            onBuildSuggestedReplies={() => void buildSuggestedReplies()}
            onSetSuggestedQuestionCount={setSuggestedQuestionCount}
            onBuildSuggestedQuestions={(count) => void buildSuggestedQuestions(count)}
            onBuildFeedback={buildFeedback}
            onSaveSession={saveSession}
            onToggleVoiceInput={(target) => void toggleVoiceInput(target)}
          />
        )}

        {activeMenu === "settings" && <SettingsView />}

        {activeMenu === "profile" && user && (
          <ProfileView
            apiUrl={apiUrl}
            token={token}
            user={user}
            appVersion={appUpdate.state.currentVersion}
            appUpdate={appUpdate}
            onOpenSettings={() => openMenu("settings")}
          />
        )}
      </div>
    </main>
  );
}

type UpdateStatus = "idle" | "checking" | "uptodate" | "available" | "downloading" | "error";

function ProfileView({
  apiUrl,
  token,
  user,
  appVersion,
  appUpdate,
  onOpenSettings,
}: {
  apiUrl: string;
  token: string;
  user: NonNullable<ReturnType<typeof useAuthSession>["user"]>;
  appVersion: string;
  appUpdate: AppUpdateControls;
  onOpenSettings: () => void;
}) {
  const displayName = user.username || user.email;
  const roleName = user.role.name || user.role.code.replace("ROLE_", "");
  const initials = displayName.slice(0, 2).toUpperCase();
  const [apiKeyStatus, setApiKeyStatus] = useState<OpenAiApiKeyResponse | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [apiKeyLoading, setApiKeyLoading] = useState(true);
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [apiKeyDeleting, setApiKeyDeleting] = useState(false);
  const [apiKeyValidating, setApiKeyValidating] = useState(false);
  const [apiKeyMessage, setApiKeyMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [apiKeyValidation, setApiKeyValidation] = useState<OpenAiApiKeyValidationResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setApiKeyLoading(true);
      setApiKeyMessage(null);
      try {
        const data = await getOpenAiApiKey(apiUrl, token);
        if (!cancelled) setApiKeyStatus(data);
      } catch (error) {
        if (!cancelled) {
          setApiKeyMessage({ tone: "error", text: error instanceof Error ? error.message : "API 키 정보를 불러오지 못했습니다." });
        }
      } finally {
        if (!cancelled) setApiKeyLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apiUrl, token]);

  const saveApiKey = async () => {
    const key = apiKeyDraft.trim();
    if (!key) {
      setApiKeyMessage({ tone: "error", text: "API 키를 입력해주세요." });
      return;
    }

    setApiKeySaving(true);
    setApiKeyMessage(null);
    setApiKeyValidation(null);
    try {
      const data = await saveOpenAiApiKey(apiUrl, token, key);
      setApiKeyStatus(data);
      setApiKeyDraft("");
      setApiKeyVisible(false);
      setApiKeyMessage({ tone: "success", text: "API 키를 저장했습니다." });
    } catch (error) {
      setApiKeyMessage({ tone: "error", text: error instanceof Error ? error.message : "API 키 저장에 실패했습니다." });
    } finally {
      setApiKeySaving(false);
    }
  };

  const deleteApiKey = async () => {
    if (!apiKeyStatus?.configured) return;
    const confirmed = window.confirm("저장된 OpenAI API 키를 삭제할까요?");
    if (!confirmed) return;

    setApiKeyDeleting(true);
    setApiKeyMessage(null);
    setApiKeyValidation(null);
    try {
      await deleteOpenAiApiKey(apiUrl, token);
      setApiKeyStatus({ configured: false, maskedKey: "" });
      setApiKeyMessage({ tone: "success", text: "API 키를 삭제했습니다." });
    } catch (error) {
      setApiKeyMessage({ tone: "error", text: error instanceof Error ? error.message : "API 키 삭제에 실패했습니다." });
    } finally {
      setApiKeyDeleting(false);
    }
  };

  const validateApiKey = async () => {
    if (!apiKeyDraft.trim() && !apiKeyStatus?.configured) return;

    setApiKeyValidating(true);
    setApiKeyMessage(null);
    try {
      const data = apiKeyDraft.trim()
        ? await validateOpenAiApiKeyDraft(apiKeyDraft)
        : await validateOpenAiApiKey(apiUrl, token);
      setApiKeyValidation(data);
    } catch (error) {
      setApiKeyMessage({ tone: "error", text: error instanceof Error ? error.message : "키 유효성 확인에 실패했습니다." });
    } finally {
      setApiKeyValidating(false);
    }
  };

  return (
    <section style={{ padding: 24, width: "100%", maxWidth: 760, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <UserCircle size={23} color="#059669" />
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>프로필</h1>
      </div>
      <p style={{ color: "#6b7280", fontSize: 13, marginTop: 0, marginBottom: 20 }}>내 계정 · 권한 정보</p>

      <div style={{ overflow: "hidden", border: "1px solid #d8e0ea", borderRadius: 12, background: "#fff", boxShadow: "0 14px 34px rgba(15, 23, 42, 0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, padding: 22, borderBottom: "1px solid #eef2f7", background: "linear-gradient(135deg, #f8fafc 0%, #eef8f3 100%)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
            <div style={{ display: "grid", placeItems: "center", width: 58, height: 58, flex: "0 0 auto", borderRadius: "999px", color: "#047857", background: "#ecfdf5", border: "1px solid #a7f3d0", fontSize: 17, fontWeight: 950 }}>
              {initials}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ overflow: "hidden", color: "#0f172a", fontSize: 20, fontWeight: 900, lineHeight: "28px", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</div>
              <div style={{ overflow: "hidden", color: "#64748b", fontSize: 13, fontWeight: 700, lineHeight: "20px", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</div>
            </div>
          </div>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 10px", borderRadius: 999, color: "#047857", background: "#ecfdf5", fontSize: 12, fontWeight: 900 }}>
            <ShieldCheck size={14} />
            {roleName}
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
          <ProfileInfoRow icon={<Mail size={17} />} label="이메일" value={user.email} />
          <ProfileInfoRow icon={<ShieldCheck size={17} />} label="역할" value={roleName} />
          <ProfileInfoRow icon={<KeyRound size={17} />} label="권한 수" value={`${user.permissions.length}개`} />
          <ProfileInfoRow icon={<SettingsIcon size={17} />} label="앱 버전" value={`v${appVersion}`} />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: 16, borderTop: "1px solid #eef2f7" }}>
          <button
            type="button"
            onClick={onOpenSettings}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 36, padding: "0 14px", border: "1px solid #d1d5db", borderRadius: 8, color: "#18181b", background: "#fff", fontSize: 13, fontWeight: 800 }}
          >
            <SettingsIcon size={16} />
            앱 설정
          </button>
        </div>
      </div>

      <AppUpdatePanel
        updateState={appUpdate.state}
        busy={appUpdate.busy}
        onCheckUpdate={() => void appUpdate.checkForUpdate()}
        onInstallUpdate={() => void appUpdate.installUpdate()}
      />

      <div style={{ marginTop: 16, overflow: "hidden", border: "1px solid #d8e0ea", borderRadius: 12, background: "#fff", boxShadow: "0 14px 34px rgba(15, 23, 42, 0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: 16, borderBottom: "1px solid #eef2f7" }}>
          <div>
            <div style={{ color: "#0f172a", fontSize: 15, fontWeight: 900 }}>OpenAI API 키</div>
            <div style={{ color: "#64748b", fontSize: 12, lineHeight: "18px", marginTop: 2 }}>개인 키를 저장하면 AI 회화·번역 호출에 본인 키를 사용합니다.</div>
          </div>
          <span style={{ display: "inline-flex", alignItems: "center", height: 28, padding: "0 9px", borderRadius: 999, color: apiKeyStatus?.configured ? "#047857" : "#71717a", background: apiKeyStatus?.configured ? "#ecfdf5" : "#f4f4f5", fontSize: 12, fontWeight: 900 }}>
            {apiKeyLoading ? "확인 중" : apiKeyStatus?.configured ? "저장됨" : "미설정"}
          </span>
        </div>

        <div style={{ display: "grid", gap: 14, padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 42, padding: "10px 12px", border: "1px solid #eef2f7", borderRadius: 9, background: "#f8fafc" }}>
            <span style={{ color: "#64748b", fontSize: 12, fontWeight: 800 }}>현재 키</span>
            <span style={{ color: "#18181b", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, fontWeight: 800 }}>
              {apiKeyLoading ? "상태 확인 중..." : apiKeyStatus?.configured ? apiKeyStatus.maskedKey || "********" : "저장된 키가 없습니다."}
            </span>
          </div>

          <div>
            <label style={{ display: "block", color: "#64748b", fontSize: 12, fontWeight: 900, marginBottom: 6 }}>새 API 키</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type={apiKeyVisible ? "text" : "password"}
                value={apiKeyDraft}
                onChange={(event) => setApiKeyDraft(event.target.value)}
                placeholder="sk-..."
                autoComplete="off"
                spellCheck={false}
                style={{ minWidth: 0, flex: 1, height: 38, padding: "0 12px", border: "1px solid #cbd5e1", borderRadius: 8, color: "#0f172a", background: "#fff", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13, outline: "none" }}
              />
              <button
                type="button"
                onClick={() => setApiKeyVisible((value) => !value)}
                style={{ height: 38, padding: "0 12px", border: "1px solid #d1d5db", borderRadius: 8, color: "#52525b", background: "#fff", fontSize: 12, fontWeight: 800 }}
              >
                {apiKeyVisible ? "숨기기" : "보기"}
              </button>
            </div>
            <p style={{ margin: "6px 0 0", color: "#94a3b8", fontSize: 11, lineHeight: "16px" }}>저장 시 서버에서 암호화되며, 저장 후 원문은 다시 표시되지 않습니다.</p>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 }}>
            <button
              type="button"
              onClick={() => void validateApiKey()}
              disabled={apiKeyValidating || (!apiKeyDraft.trim() && !apiKeyStatus?.configured)}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", height: 36, padding: "0 14px", border: "1px solid #d1d5db", borderRadius: 8, color: "#18181b", background: "#fff", fontSize: 13, fontWeight: 800, opacity: apiKeyValidating || (!apiKeyDraft.trim() && !apiKeyStatus?.configured) ? 0.55 : 1 }}
            >
              {apiKeyValidating ? "확인 중..." : "유효성 확인"}
            </button>
            <button
              type="button"
              onClick={() => void saveApiKey()}
              disabled={apiKeySaving || !apiKeyDraft.trim()}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", height: 36, padding: "0 14px", border: "1px solid #059669", borderRadius: 8, color: "#fff", background: "#059669", fontSize: 13, fontWeight: 900, opacity: apiKeySaving || !apiKeyDraft.trim() ? 0.55 : 1 }}
            >
              {apiKeySaving ? "저장 중..." : "저장"}
            </button>
            <button
              type="button"
              onClick={() => void deleteApiKey()}
              disabled={apiKeyDeleting || !apiKeyStatus?.configured}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", height: 36, padding: "0 14px", border: "1px solid #fecaca", borderRadius: 8, color: "#b91c1c", background: "#fff", fontSize: 13, fontWeight: 800, opacity: apiKeyDeleting || !apiKeyStatus?.configured ? 0.55 : 1 }}
            >
              {apiKeyDeleting ? "삭제 중..." : "삭제"}
            </button>
          </div>

          {apiKeyValidation && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", border: `1px solid ${apiKeyValidation.valid ? "#a7f3d0" : "#fecaca"}`, borderRadius: 9, color: apiKeyValidation.valid ? "#047857" : "#b91c1c", background: apiKeyValidation.valid ? "#ecfdf5" : "#fef2f2", fontSize: 12, fontWeight: 800 }}>
              {apiKeyValidation.valid ? <CheckCircle2 size={16} /> : <CircleAlert size={16} />}
              {apiKeyValidation.message}
            </div>
          )}

          {apiKeyMessage && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", border: `1px solid ${apiKeyMessage.tone === "success" ? "#a7f3d0" : apiKeyMessage.tone === "error" ? "#fecaca" : "#d8e0ea"}`, borderRadius: 9, color: apiKeyMessage.tone === "success" ? "#047857" : apiKeyMessage.tone === "error" ? "#b91c1c" : "#52525b", background: apiKeyMessage.tone === "success" ? "#ecfdf5" : apiKeyMessage.tone === "error" ? "#fef2f2" : "#f8fafc", fontSize: 12, fontWeight: 800 }}>
              {apiKeyMessage.tone === "success" ? <CheckCircle2 size={16} /> : apiKeyMessage.tone === "error" ? <CircleAlert size={16} /> : <KeyRound size={16} />}
              {apiKeyMessage.text}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ProfileInfoRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, padding: 16, borderRight: "1px solid #eef2f7", borderBottom: "1px solid #eef2f7" }}>
      <div style={{ display: "grid", placeItems: "center", width: 34, height: 34, flex: "0 0 auto", borderRadius: 9, color: "#047857", background: "#ecfdf5" }}>
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 900, lineHeight: "15px" }}>{label}</div>
        <div style={{ overflow: "hidden", color: "#18181b", fontSize: 14, fontWeight: 800, lineHeight: "20px", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
      </div>
    </div>
  );
}

function SettingsView() {
  const [version, setVersion] = useState(appVersion);
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [newVersion, setNewVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const updateRef = useRef<Update | null>(null);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  const checkForUpdate = async () => {
    setStatus("checking");
    setMessage("");
    try {
      const update = await check();
      updateRef.current = update;
      if (update) {
        setNewVersion(update.version);
        setNotes(update.body ?? "");
        setStatus("available");
      } else {
        setStatus("uptodate");
      }
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "업데이트 확인에 실패했습니다.");
    }
  };

  const install = async () => {
    const update = updateRef.current;
    if (!update) return;
    setStatus("downloading");
    setProgress(0);
    setMessage("");
    try {
      let total = 0;
      let downloaded = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (total > 0) setProgress(Math.min(100, Math.round((downloaded / total) * 100)));
        }
      });
      // 설치 완료 → 재시작하면 새 버전으로 뜬다.
      await relaunch();
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "업데이트 설치에 실패했습니다.");
    }
  };

  const busy = status === "checking" || status === "downloading";

  return (
    <section style={{ padding: 24, width: "100%", maxWidth: 640, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <SettingsIcon size={22} color="#2563eb" />
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>설정</h1>
      </div>
      <p style={{ color: "#6b7280", fontSize: 13, marginTop: 0, marginBottom: 20 }}>계정 · 앱 환경</p>

      <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>앱 업데이트</div>
            <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>현재 버전 v{version}</div>
          </div>
          <button
            onClick={() => void checkForUpdate()}
            disabled={busy}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, height: 36, padding: "0 14px",
              borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", fontSize: 14, fontWeight: 600,
              cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
            }}
          >
            {status === "checking" ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
            {status === "checking" ? "확인 중…" : "업데이트 확인"}
          </button>
        </div>

        {status === "uptodate" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, color: "#059669", fontSize: 14 }}>
            <CheckCircle2 size={18} /> 최신 버전을 사용 중입니다.
          </div>
        )}

        {(status === "available" || status === "downloading") && (
          <div style={{ marginTop: 14, padding: 14, borderRadius: 10, background: "#eff6ff", border: "1px solid #bfdbfe" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1d4ed8" }}>새 버전 v{newVersion} 이 있습니다</div>
            {notes && <div style={{ fontSize: 12, color: "#475569", marginTop: 6, whiteSpace: "pre-wrap" }}>{notes}</div>}
            {status === "downloading" ? (
              <div style={{ marginTop: 12 }}>
                <div style={{ height: 8, borderRadius: 999, background: "#dbeafe", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${progress}%`, background: "#2563eb", transition: "width .2s" }} />
                </div>
                <div style={{ fontSize: 12, color: "#475569", marginTop: 6 }}>다운로드 {progress}% — 완료되면 자동으로 재시작됩니다.</div>
              </div>
            ) : (
              <button
                onClick={() => void install()}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, height: 36, padding: "0 14px", marginTop: 12,
                  borderRadius: 8, border: "none", background: "#2563eb", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer",
                }}
              >
                <Download size={16} /> 지금 업데이트하고 재시작
              </button>
            )}
          </div>
        )}

        {status === "error" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, color: "#dc2626", fontSize: 13 }}>
            <CircleAlert size={18} /> {message || "오류가 발생했습니다."}
          </div>
        )}
      </div>
    </section>
  );
}
