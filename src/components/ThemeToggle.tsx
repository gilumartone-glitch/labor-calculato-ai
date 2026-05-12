import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";

export const ThemeToggle = () => {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      title={theme === "dark" ? "Passa a tema chiaro" : "Passa a tema scuro"}
      className="inline-flex items-center justify-center w-8 h-8 border-2 border-ink/30 hover:border-ink rounded-sm transition-colors"
    >
      {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
    </button>
  );
};