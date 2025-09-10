import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function PlaceholderDashboard({ title }: { title: string }) {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Metric One</CardTitle>
            <CardDescription>Sample description</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">95.2%</div>
            <p className="text-xs text-muted-foreground">+2.1% from last period</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Metric Two</CardTitle>
            <CardDescription>Sample description</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">$12.4K</div>
            <p className="text-xs text-muted-foreground">+5.2% from last period</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Metric Three</CardTitle>
            <CardDescription>Sample description</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">842</div>
            <p className="text-xs text-muted-foreground">-1.8% from last period</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Placeholder Content</CardTitle>
          <CardDescription>This is a placeholder dashboard. Real content will be implemented later.</CardDescription>
        </CardHeader>
        <CardContent className="h-80 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <p className="text-lg">Content coming soon</p>
            <p className="text-sm">This section will contain relevant data visualizations and tables</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
