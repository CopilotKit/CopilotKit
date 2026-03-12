import React, { useEffect, useState, memo, useMemo } from "react";
import { Loader2 } from "lucide-react";

interface LoaderProps { texts: string[] }

export const Loader: React.FC<LoaderProps> = memo(({ texts }) => {
    return (
        <div className="flex items-center justify-start gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-gray-600" />
            <span className="text-sm text-gray-600">{texts[0]}</span>
        </div>
    );
});


