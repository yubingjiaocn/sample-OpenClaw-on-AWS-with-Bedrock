import { useEffect, useState } from 'react';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import { BarChart3, Zap, DollarSign, Clock } from 'lucide-react';
import { api } from '../../api/client';
import { Card, StatCard } from '../../components/ui';

const chartOpts: ApexOptions = {
  chart: { type: 'bar', toolbar: { show: false }, background: 'transparent' },
  colors: ['#6366f1'],
  plotOptions: { bar: { borderRadius: 4, columnWidth: '60%' } },
  grid: { borderColor: '#2e3039', strokeDashArray: 4 },
  xaxis: { labels: { style: { colors: '#64748b', fontSize: '11px' } }, axisBorder: { show: false }, axisTicks: { show: false } },
  yaxis: { labels: { style: { colors: '#64748b', fontSize: '11px' } } },
  tooltip: { theme: 'dark' },
  dataLabels: { enabled: false },
};

export default function MyUsage() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    api.get<any>('/portal/usage').then(setData).catch(() => {});
  }, []);

  if (!data) return <div className="p-6 text-text-muted">Loading...</div>;

  const daily = data.dailyUsage || [];

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-xl font-bold text-text-primary">My Usage</h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard title="Requests" value={data.totalRequests || 0} icon={<Zap size={22} />} color="primary" />
        <StatCard title="Tokens" value={`${(((data.totalInputTokens || 0) + (data.totalOutputTokens || 0)) / 1000).toFixed(0)}k`} icon={<BarChart3 size={22} />} color="info" />
        <StatCard title="Cost" value={`$${(data.totalCost || 0).toFixed(2)}`} icon={<DollarSign size={22} />} color="success" />
        <StatCard title="Avg/Day" value={daily.length > 0 ? Math.round((data.totalRequests || 0) / daily.length) : 0} icon={<Clock size={22} />} color="cyan" />
      </div>

      <Card>
        <h3 className="text-sm font-semibold text-text-primary mb-4">Daily Requests</h3>
        <Chart
          options={{ ...chartOpts, xaxis: { ...chartOpts.xaxis, categories: daily.map((d: any) => d.date?.slice(5)) } }}
          series={[{ name: 'Requests', data: daily.map((d: any) => d.requests) }]}
          type="bar" height={240}
        />
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-text-primary mb-4">Daily Cost</h3>
        <div className="space-y-2">
          {daily.map((d: any) => (
            <div key={d.date} className="flex items-center justify-between rounded-lg bg-dark-bg px-4 py-2">
              <span className="text-sm text-text-secondary">{d.date}</span>
              <div className="flex items-center gap-4">
                <span className="text-xs text-text-muted">{d.requests} requests</span>
                <span className="text-sm font-medium text-text-primary">${(d.cost || 0).toFixed(4)}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
