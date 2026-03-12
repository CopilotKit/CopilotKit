import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useResearch } from "@/components/research-context";
import { SourceItem } from "@/components/resource-item";

export default function SourcesModal() {
    const { state, sourcesModalOpen, setSourcesModalOpen } = useResearch()
    const sourcesEntries = Object.entries(state.sources ?? {})

    return (
        <Dialog open={sourcesModalOpen} onOpenChange={setSourcesModalOpen}>
            <DialogContent className="sm:max-w-[625px] bg-[#F5F0EA]">
                <DialogHeader>
                    <DialogTitle>Sources</DialogTitle>
                </DialogHeader>
                {sourcesEntries.length > 0 ? (
                    <div className="max-h-[400px] overflow-y-auto">
                        <div className="space-y-2 pr-2">
                            {sourcesEntries.map(([id, source]) => <SourceItem source={source} id={id} key={id}/>)}
                        </div>
                    </div>
                ) : (
                    <p className="font-noto flex items-center justify-center w-full h-full">
                        Once a research was initiated, resources will show up here
                    </p>
                )}
            </DialogContent>
        </Dialog>
    )
}