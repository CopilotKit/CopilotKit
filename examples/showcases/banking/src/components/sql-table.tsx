import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Database } from "lucide-react";

export function SqlTable({
    databaseStructure
}: {
    databaseStructure: Record<string, { name: string, type: string }[]>
}) {
    return (
        <div className="space-y-6">
            {Object.entries(databaseStructure).map(([tableName, fields]) => (
                <TableCard key={tableName} name={tableName} fields={fields} />
            ))}
        </div>
    )
}

function TableCard({ name, fields }: { name: string, fields: { name: string, type: string }[] }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center">
                    <Database className="mr-2 h-4 w-4" />
                    {name}
                </CardTitle>
            </CardHeader>
            <CardContent>
                <ul className="space-y-1">
                    {fields.map((field, index) => (
                        <li key={index} className="text-sm">
                            <span className="font-medium">{field.name}</span>: <span className="text-muted-foreground">{field.type}</span>
                        </li>
                    ))}
                </ul>
            </CardContent>
        </Card>
    )
}
