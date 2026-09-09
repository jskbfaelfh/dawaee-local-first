/**
 * Excel / CSV Export Utility
 * Generates UTF-8 BOM encoded CSV files which open seamlessly in Microsoft Excel with full Arabic character support.
 */

export function exportToExcel(
  data: Record<string, any>[],
  fileName: string = 'export',
): void {
  if (!data || data.length === 0) {
    alert('لا توجد بيانات لتصديرها');
    return;
  }

  const headers = Object.keys(data[0]);
  const rows = data.map((row) =>
    headers
      .map((header) => {
        let val = row[header];
        if (val === null || val === undefined) {
          val = '';
        }
        val = String(val).replace(/"/g, '""');
        return `"${val}"`;
      })
      .join(','),
  );

  const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.setAttribute('href', url);
  link.setAttribute('download', `${fileName}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
