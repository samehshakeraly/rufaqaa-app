import { useQuery } from "@tanstack/react-query";

import { listOrphans } from "@/lib/orphans";

const STATUS_LABELS: Record<string, string> = {
  pending_review: "قيد المراجعة",
  approved: "معتمد",
  available: "متاح للكفالة",
  reserved: "محجوز",
  sponsored: "مكفول",
  graduated: "متخرّج",
  rejected: "مرفوض",
  deceased: "متوفّى",
  archived: "مؤرشف",
};

export function OrphansPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["orphans", { limit: 20, offset: 0 }],
    queryFn: () => listOrphans({ limit: 20, offset: 0 }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">الأيتام</h1>
        {data && (
          <span className="text-sm text-slate-500">
            الإجمالي: {data.total.toLocaleString("ar")}
          </span>
        )}
      </div>

      {isLoading && <p className="text-slate-500">جاري التحميل...</p>}
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          تعذّر تحميل قائمة الأيتام
        </p>
      )}

      {data && data.items.length === 0 && (
        <div className="card text-center text-slate-500">
          لا توجد بيانات بعد. أنشئ ملف يتيم من نقطة النهاية{" "}
          <code className="font-mono text-xs">POST /api/v1/orphans</code>.
        </div>
      )}

      {data && data.items.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <table className="min-w-full text-right">
            <thead className="border-b border-sky bg-tranquil/40 text-sm text-slate-700">
              <tr>
                <th className="px-4 py-3 font-medium">الرمز</th>
                <th className="px-4 py-3 font-medium">الاسم</th>
                <th className="px-4 py-3 font-medium">تاريخ الميلاد</th>
                <th className="px-4 py-3 font-medium">الجنس</th>
                <th className="px-4 py-3 font-medium">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sky/40 text-sm">
              {data.items.map((o) => (
                <tr key={o.id} className="hover:bg-snow">
                  <td className="px-4 py-3 font-mono text-xs">{o.code}</td>
                  <td className="px-4 py-3">
                    {o.first_name} {o.family_name}
                  </td>
                  <td className="px-4 py-3">{o.date_of_birth}</td>
                  <td className="px-4 py-3">{o.gender === "M" ? "ذكر" : "أنثى"}</td>
                  <td className="px-4 py-3">
                    {STATUS_LABELS[o.case_status] ?? o.case_status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
