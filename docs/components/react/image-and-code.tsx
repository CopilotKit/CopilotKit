import {Tabs, Tab} from "@/components/react/tabs"
import { Frame } from "@/components/react/frame"

export function ImageAndCode({ preview, children, id }: { preview: string | React.ReactNode; children: React.ReactNode, id: string }) {
    return (
        <Tabs groupId={id} items={["Preview", "Code"]}>
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