import {
  Building2,
  ChartNoAxesColumn,
  Download,
  History,
  Landmark,
  Lock,
  Settings,
  ShieldCheck,
  Target,
  Briefcase,
  UserRoundCheck,
  Users,
} from "lucide-react";
import type { NavIconKey } from "@/lib/nav";

/**
 * Icon của sidebar, lấy từ lucide-react.
 *
 * Bảng tra nằm ở đây chứ không để `nav.ts` import thẳng component: `nav.ts` là
 * logic quyền, chạy được cả ngoài React — kéo component vào đó là trói nó vào
 * tầng giao diện.
 */
const ICONS = {
  overview: ChartNoAxesColumn,
  insurance: ShieldCheck,
  banking: Landmark,
  services: Briefcase,
  customers: Users,
  people: UserRoundCheck,
  target: Target,
  settings: Settings,
  exports: Download,
  permissions: Lock,
  org: Building2,
  audit: History,
} as const satisfies Record<NavIconKey, unknown>;

export function NavIcon({ name }: { name: NavIconKey }) {
  const Icon = ICONS[name];
  // Icon nhận màu từ chữ nên mục đang mở đảo nền là nó tự trắng theo.
  return <Icon size={18} strokeWidth={1.8} aria-hidden />;
}
