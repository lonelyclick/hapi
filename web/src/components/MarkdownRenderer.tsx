import type { ComponentPropsWithoutRef } from 'react'
import type { MarkdownTextPrimitiveProps } from '@assistant-ui/react-markdown'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

interface MarkdownRendererProps {
    content: string
    components?: MarkdownTextPrimitiveProps['components']
}

// Simpler code block for standalone rendering (no syntax highlighting to keep it lightweight)
function Pre(props: ComponentPropsWithoutRef<'pre'>) {
    const { className, children, ...rest } = props
    return (
        <div className="aui-md-pre-wrapper min-w-0 w-full max-w-full overflow-x-auto overflow-y-hidden my-2">
            <pre
                {...rest}
                className={cn(
                    'aui-md-pre m-0 w-max min-w-full rounded-md bg-[var(--app-code-bg)] p-2 text-xs',
                    className
                )}
            >
                {children}
            </pre>
        </div>
    )
}

function Code(props: ComponentPropsWithoutRef<'code'>) {
    const { className, ...rest } = props
    const isCodeBlock = className?.includes('language-')

    if (isCodeBlock) {
        return <code {...rest} className={cn('font-mono', className)} />
    }

    return (
        <code
            {...rest}
            className={cn(
                'break-words rounded bg-[var(--app-inline-code-bg)] px-[0.3em] py-[0.1em] font-mono text-[0.9em]',
                className
            )}
        />
    )
}

function A(props: ComponentPropsWithoutRef<'a'>) {
    const rel = props.target === '_blank' ? (props.rel ?? 'noreferrer') : props.rel
    return <a {...props} rel={rel} className={cn('text-[var(--app-link)] underline', props.className)} />
}

function Paragraph(props: ComponentPropsWithoutRef<'p'>) {
    return <p {...props} className={cn('leading-relaxed my-1', props.className)} />
}

function Blockquote(props: ComponentPropsWithoutRef<'blockquote'>) {
    return (
        <blockquote
            {...props}
            className={cn('border-l-4 border-[var(--app-hint)] pl-3 opacity-85 my-2', props.className)}
        />
    )
}

function UnorderedList(props: ComponentPropsWithoutRef<'ul'>) {
    return <ul {...props} className={cn('list-disc pl-6 my-1', props.className)} />
}

function OrderedList(props: ComponentPropsWithoutRef<'ol'>) {
    return <ol {...props} className={cn('list-decimal pl-6 my-1', props.className)} />
}

function ListItem(props: ComponentPropsWithoutRef<'li'>) {
    return <li {...props} className={cn('', props.className)} />
}

function Hr(props: ComponentPropsWithoutRef<'hr'>) {
    return <hr {...props} className={cn('border-[var(--app-divider)] my-2', props.className)} />
}

function Table(props: ComponentPropsWithoutRef<'table'>) {
    return (
        <div className="max-w-full overflow-x-auto my-2">
            <table {...props} className={cn('w-full border-collapse', props.className)} />
        </div>
    )
}

function Th(props: ComponentPropsWithoutRef<'th'>) {
    return (
        <th
            {...props}
            className={cn(
                'border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-2 py-1 text-left font-semibold',
                props.className
            )}
        />
    )
}

function Td(props: ComponentPropsWithoutRef<'td'>) {
    return <td {...props} className={cn('border border-[var(--app-border)] px-2 py-1', props.className)} />
}

function H1(props: ComponentPropsWithoutRef<'h1'>) {
    return <h1 {...props} className={cn('mt-3 text-base font-semibold', props.className)} />
}

function H2(props: ComponentPropsWithoutRef<'h2'>) {
    return <h2 {...props} className={cn('mt-3 text-sm font-semibold', props.className)} />
}

function H3(props: ComponentPropsWithoutRef<'h3'>) {
    return <h3 {...props} className={cn('mt-2 text-sm font-semibold', props.className)} />
}

function Strong(props: ComponentPropsWithoutRef<'strong'>) {
    return <strong {...props} className={cn('font-semibold', props.className)} />
}

function Em(props: ComponentPropsWithoutRef<'em'>) {
    return <em {...props} className={cn('italic', props.className)} />
}

function Image(props: ComponentPropsWithoutRef<'img'>) {
    return <img {...props} className={cn('max-w-full rounded', props.className)} />
}

const defaultComponents = {
    pre: Pre,
    code: Code,
    a: A,
    p: Paragraph,
    blockquote: Blockquote,
    ul: UnorderedList,
    ol: OrderedList,
    li: ListItem,
    hr: Hr,
    table: Table,
    th: Th,
    td: Td,
    h1: H1,
    h2: H2,
    h3: H3,
    strong: Strong,
    em: Em,
    img: Image,
}

/**
 * Standalone markdown renderer that doesn't require being inside a Thread context.
 * Used for rendering markdown in group chat messages and other standalone contexts.
 */
export function MarkdownRenderer(props: MarkdownRendererProps) {
    const mergedComponents = props.components
        ? { ...defaultComponents, ...props.components }
        : defaultComponents

    return (
        <div className={cn('aui-md min-w-0 max-w-full break-words text-sm')}>
            <Markdown remarkPlugins={[remarkGfm]} components={mergedComponents}>
                {props.content}
            </Markdown>
        </div>
    )
}
