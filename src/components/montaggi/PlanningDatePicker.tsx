import { format } from "date-fns";
import { it } from "date-fns/locale";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function PlanningDatePicker({ value, onChange, label }: { value: string; onChange: (date: string) => void; label: string }) {
  const date = value ? new Date(`${value}T00:00:00`) : undefined;
  return <Popover>
    <PopoverTrigger asChild><Button variant="outline" aria-label={label} className="w-full justify-start font-normal">
      <CalendarDays className="h-4 w-4 shrink-0" />{date ? format(date, "dd/MM/yyyy") : "—"}
    </Button></PopoverTrigger>
    <PopoverContent className="w-auto p-0" align="start">
      <Calendar locale={it} mode="single" selected={date} defaultMonth={date} onSelect={selected => selected && onChange(format(selected, "yyyy-MM-dd"))} initialFocus className="p-3 pointer-events-auto" />
    </PopoverContent>
  </Popover>;
}