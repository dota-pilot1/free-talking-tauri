import {
  MessagesSquare,
  Settings,
  UserCircle,
  type LucideIcon,
} from "lucide-react";

export type WebMenuId = "englishConversation" | "profile" | "settings";

export type WebMenu = {
  id: WebMenuId;
  label: string;
  subtitle: string;
  icon: LucideIcon;
  children?: string[];
};

export const WEB_HEADER_MENUS: WebMenu[] = [
  {
    id: "englishConversation",
    label: "영어 회화",
    subtitle: "AI 회화 · 표현 피드백",
    icon: MessagesSquare,
  },
  {
    id: "settings",
    label: "설정",
    subtitle: "계정 · 앱 환경",
    icon: Settings,
  },
];

export const PROFILE_MENU: WebMenu = {
  id: "profile",
  label: "프로필",
  subtitle: "내 계정 · 권한 정보",
  icon: UserCircle,
};
