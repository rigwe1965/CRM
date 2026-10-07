"use client";

// Loaded lazily by the dashboard (next/dynamic) so the charting library stays out of its first-load bundle.
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CONTACT_TYPES, DEAL_STAGES } from "@/lib/client/constants";
import { money } from "@/lib/client/format";
import type { ContactType } from "@/lib/client/types";

const TOOLTIP_STYLE = {
  background: "hsl(var(--popover))",
  color: "hsl(var(--popover-foreground))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 12,
};

type Stage = { stage: string; count: number; amount: Record<string, number> };

export function PipelineChart({ stages, currency }: { stages: Stage[]; currency: string }) {
  return (
    <div className="h-64" role="img" aria-label="Bar chart of deal value by pipeline stage">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={stages.map((s) => ({
            name: DEAL_STAGES.find((d) => d.value === s.stage)!.label,
            stage: s.stage,
            amount: s.amount[currency] ?? 0,
            count: s.count,
          }))}
          margin={{ left: 0, right: 8, top: 8 }}
        >
          <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} stroke="hsl(var(--muted-foreground))" />
          <YAxis tickLine={false} axisLine={false} fontSize={12} width={56} stroke="hsl(var(--muted-foreground))" tickFormatter={(v: number) => money(v, currency, true)} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            cursor={{ fill: "hsl(var(--muted))" }}
            formatter={(value, _n, item) => [`${money(Number(value), currency)} (${item.payload.count} deals)`, "Value"]}
          />
          <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
            {stages.map((s) => (
              <Cell key={s.stage} fill={DEAL_STAGES.find((d) => d.value === s.stage)!.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ContactsChart({ counts, colors }: { counts: Record<string, number>; colors: Record<ContactType, string> }) {
  return (
    <div className="h-44" role="img" aria-label="Donut chart of contacts by type">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={CONTACT_TYPES.map((t) => ({ name: t.label, type: t.value, value: counts[t.value] ?? 0 })).filter((d) => d.value > 0)}
            dataKey="value"
            innerRadius={48}
            outerRadius={72}
            paddingAngle={2}
            stroke="hsl(var(--card))"
          >
            {CONTACT_TYPES.filter((t) => (counts[t.value] ?? 0) > 0).map((t) => (
              <Cell key={t.value} fill={colors[t.value]} />
            ))}
          </Pie>
          <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: "hsl(var(--popover-foreground))" }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
