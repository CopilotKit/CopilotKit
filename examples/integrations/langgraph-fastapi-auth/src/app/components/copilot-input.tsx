import { CopilotChatInput, type CopilotChatInputProps } from '@copilotkit/react-core/v2';
import {
    createContext,
    useContext,
    useRef,
    useState,
} from 'react';

export type FileUpload = {
    fileId: string;
    name: string;
    pageCount?: number;
    sheetCount?: number;
    totalRows?: number;
    extractedText: string;
    fileType: 'pdf' | 'excel' | 'csv';
};

type FileUploadContextValue = {
    uploadedFiles: FileUpload[];
    fetchUploadedFiles: () => Promise<void>;
    threadId?: string;
    // Only signed-in users can upload; file requests carry their bearer token.
    canUpload: boolean;
    authHeaders: Record<string, string>;
};

// The chat renders its input through a slot, so the uploaded files are provided
// via context instead of props. This keeps the input component identity stable,
// so it isn't remounted (and the draft text lost) whenever the file list changes.
export const FileUploadContext = createContext<FileUploadContextValue>({
    uploadedFiles: [],
    fetchUploadedFiles: async () => {},
    canUpload: false,
    authHeaders: {},
});

const CopilotInputBase = (props: CopilotChatInputProps) => {
    const { uploadedFiles, fetchUploadedFiles, threadId, canUpload, authHeaders } = useContext(FileUploadContext);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        // Filter supported files (PDF and Excel)
        const supportedFiles = Array.from(files).filter(file => 
            file.type === 'application/pdf' || 
            file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            file.type === 'text/csv'
        );
        
        if (supportedFiles.length === 0) {
            alert('Please upload PDF, Excel, or CSV files only');
            return;
        }

        if (supportedFiles.length !== files.length) {
            alert(`Only PDF, Excel, and CSV files will be uploaded. ${files.length - supportedFiles.length} unsupported file(s) skipped.`);
        }

        setIsUploading(true);
        const uploadPromises = supportedFiles.map(async (file) => {
            try {
                const base64Content = await fileToBase64(file);
                const endpoint = '/process-file';

                const response = await fetch(`http://localhost:8000${endpoint}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...authHeaders,
                    },
                    body: JSON.stringify({
                        filename: file.name,
                        content: base64Content,
                        thread_id: threadId,
                    }),
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.detail || `Failed to upload ${file.name}`);
                }

                const data = await response.json();
                return { status: 'success', file, data };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                return { status: 'error', file, error: message };
            }
        });

        const results = await Promise.allSettled(uploadPromises);

        let successCount = 0;
        const errorMessages: string[] = [];

        results.forEach(result => {
            if (result.status === 'fulfilled' && result.value) {
                if (result.value.status === 'success') {
                    successCount++;
                } else {
                    errorMessages.push(`- ${result.value.file.name}: ${result.value.error}`);
                }
            } else if (result.status === 'rejected') {
                errorMessages.push(`- An unexpected error occurred during upload.`);
                console.error('Unexpected upload error:', result.reason);
            }
        });

        if (successCount > 0) {
            await fetchUploadedFiles();
        }

        if (errorMessages.length > 0) {
            alert(`Upload summary:\n${successCount} file(s) uploaded successfully.\n${errorMessages.length} file(s) failed to upload:\n${errorMessages.join('\n')}`);
        }

        setIsUploading(false);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const fileToBase64 = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const base64String = reader.result as string;
                const base64Data = base64String.split(',')[1];
                resolve(base64Data);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    };

    const handleRemoveFile = async (fileId: string) => {
        if (!threadId) return;
        try {
            const response = await fetch(`http://localhost:8000/file/${threadId}/${fileId}`, {
                method: 'DELETE',
                headers: authHeaders,
            });
            if (response.ok) {
                await fetchUploadedFiles();
            } else {
                console.error('Failed to delete file');
                alert('Failed to remove the file. Please try again.');
            }
        } catch (error) {
            console.error('Error deleting file:', error);
            alert('An error occurred while removing the file.');
        }
    };

    const openFilePicker = () => {
        if (!isUploading) {
            fileInputRef.current?.click();
        }
    };

    return (
        <>
            <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.csv"
                onChange={handleFileUpload}
                className="hidden"
                multiple
            />
            {isUploading && (
                <div className="pointer-events-auto max-w-3xl mx-auto w-full px-4">
                    <div className="px-3 py-2 bg-gray-100 rounded-lg mb-2 flex items-center gap-2">
                        <span className="text-sm text-gray-700">Uploading file(s)...</span>
                    </div>
                </div>
            )}
            {uploadedFiles.length > 0 && (
                <div className="pointer-events-auto max-w-3xl mx-auto w-full px-4 flex flex-col gap-2 mb-2">
                    {uploadedFiles.map((file) => (
                        <div 
                            key={file.fileId}
                            className="px-3 py-2 bg-gray-100 rounded-lg flex items-center justify-between"
                        >
                            <div className="flex items-center gap-2">
                                {file.fileType === 'pdf' ? (
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        strokeWidth="1.5"
                                        stroke="currentColor"
                                        className="w-5 h-5 text-red-500"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                                        />
                                    </svg>
                                ) : (
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        strokeWidth="1.5"
                                        stroke="currentColor"
                                        className="w-5 h-5 text-green-600"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M12 10.875v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125M13.125 12h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125M20.625 12c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5M12 14.625v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 14.625c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m0 1.5v-1.5m0 0c0-.621.504-1.125 1.125-1.125m0 0h7.5"
                                        />
                                    </svg>
                                )}
                                <div>
                                    <div className="text-sm text-gray-700 font-medium">{file.name}</div>
                                    <div className="text-xs text-gray-500">
                                        {file.fileType === 'pdf' 
                                            ? `${file.pageCount} pages · PDF` 
                                            : file.fileType === 'excel'
                                            ? `${file.sheetCount} sheets, ${file.totalRows} rows · Excel`
                                            : `${file.totalRows} rows · CSV`
                                        } · In context
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={() => handleRemoveFile(file.fileId)}
                                className="bg-transparent border-none cursor-pointer p-1 flex items-center hover:bg-gray-200 rounded transition-colors"
                                aria-label={`Remove ${file.name}`}
                                tabIndex={0}
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    strokeWidth="1.5"
                                    stroke="currentColor"
                                    className="w-5 h-5 text-gray-500"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M6 18L18 6M6 6l12 12"
                                    />
                                </svg>
                            </button>
                        </div>
                    ))}
                </div>
            )}
            <CopilotChatInput
                {...props}
                className={`app-chat-input ${props.className ?? ''}`}
                textArea={{
                    placeholder: uploadedFiles.length > 0
                        ? `Ask about ${uploadedFiles.length} file${uploadedFiles.length > 1 ? 's' : ''}...`
                        : "Ask anything...",
                }}
                toolsMenu={canUpload ? [
                    ...(props.toolsMenu ?? []),
                    { label: "Upload files (PDF, Excel, CSV)", action: openFilePicker },
                ] : props.toolsMenu}
            />
        </>
    );
};

// The chat's `input` slot expects a component shaped like CopilotChatInput,
// including its sub-components (SendButton, TextArea, ...), so attach them here.
export const CopilotInput = Object.assign(CopilotInputBase, CopilotChatInput);
