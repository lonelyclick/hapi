import { useCallback, useEffect, useState } from 'react'
import { getAiSuggestionsEnabled, setAiSuggestionsEnabled, subscribeAiSuggestionsEnabled } from '@/lib/ai-suggestions'

export function useAiSuggestionSetting() {
    const [enabled, setEnabledState] = useState(() => getAiSuggestionsEnabled())

    useEffect(() => {
        return subscribeAiSuggestionsEnabled(() => {
            setEnabledState(getAiSuggestionsEnabled())
        })
    }, [])

    const setEnabled = useCallback((value: boolean) => {
        setAiSuggestionsEnabled(value)
        setEnabledState(value)
    }, [])

    return { enabled, setEnabled }
}
