import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/Button";

type Props = { visible: boolean; onToggle: () => void };

/** Che số trên màn để người đứng cạnh không đọc được; không thay cho phân quyền. */
export function SalaryVisibilityButton({ visible, onToggle }: Props) {
  const label = visible ? "Ẩn lương" : "Hiện lương";
  return (
    <Button
      variant="secondary"
      icon
      tooltip={label}
      aria-label={label}
      aria-pressed={visible}
      onClick={onToggle}
    >
      {visible ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
    </Button>
  );
}
