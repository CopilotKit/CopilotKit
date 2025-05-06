import { Dispatch, SetStateAction } from "react";
interface haikuProps{
    generatedHaiku : generate_haiku | Partial<generate_haiku>
    setHaikus : Dispatch<SetStateAction<generate_haiku[]>>
    haikus : generate_haiku[]
}

interface generate_haiku{
    japanese : string[] | [],        
    english : string[] | [],
    image_names : string[] | [],
    selectedImage : string | null,
}

export default function HaikuCard({generatedHaiku, setHaikus, haikus} : haikuProps) {
    return (
        <div className="suggestion-card text-left rounded-md p-4 mt-4 mb-4 flex flex-col bg-gray-100">
            <div className="border-b border-gray-300 mb-4 pb-4">
                {generatedHaiku?.japanese?.map((line, index) => (
                    <div className="flex items-center gap-3 mb-2" key={index}>
                        <p className="text-lg font-bold">{line}</p>
                        <p className="text-sm font-light">
                            {generatedHaiku.english?.[index]}
                        </p>
                    </div>
                ))}
                {generatedHaiku?.japanese && generatedHaiku.japanese.length >= 2 && (
                    <div className="mt-3 flex gap-2 justify-between w-full suggestion-image-container">
                        {(() => {
                            const firstLine = generatedHaiku?.japanese?.[0];
                            if (!firstLine) return null;
                            const haikuIndex = haikus.findIndex((h: any) => h.japanese[0] === firstLine);
                            const haiku = haikus[haikuIndex];
                            if (!haiku?.image_names) return null;

                            return haiku.image_names.map((imageName, imgIndex) => (
                                <img
                                    key={haikus.length + "_" + imageName}
                                    src={`/images/${imageName}`}
                                    alt={imageName}
                                    tabIndex={0}
                                    className={`${haiku.selectedImage === imageName ? "suggestion-card-image-focus" : "suggestion-card-image"}`}
                                    onClick={() => {
                                        console.log('Clicking image:', imageName);
                                        console.log('Current haikus:', haikus);
                                        console.log('Found index:', haikuIndex);

                                        setHaikus(prevHaikus => {
                                            console.log('Previous haikus:', prevHaikus);
                                            const newHaikus = prevHaikus.map((h, idx) => {
                                                if (idx === haikuIndex) {
                                                    console.log('Updating haiku at index:', idx);
                                                    return {
                                                        ...h,
                                                        selectedImage: imageName
                                                    };
                                                }
                                                return h;
                                            });
                                            console.log('New haikus:', newHaikus);
                                            return newHaikus;
                                        });
                                    }}
                                />
                            ));
                        })()}
                    </div>
                )}
            </div>
        </div>
    );
}
