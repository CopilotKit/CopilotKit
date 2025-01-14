import {Tabs, Tab} from "@/components/react/tabs"
import { Frame } from "@/components/react/frame"

export function ImageAndCode({ preview, children }: { preview: string | React.ReactNode; children: React.ReactNode }) {
    return (
        <Tabs items={["Preview", "Code"]}>
            <Tab value="Preview">
                {typeof preview === "string" ? 
                    <Frame>
                        <img className="rounded-lg w-full" src={preview} />
                    </Frame>
                    : 
                    preview
                }
            </Tab>
            <Tab value="Code">
                {children}
            </Tab>
        </Tabs>
    )
}