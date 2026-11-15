/** One part of a sentence a view model writes: plain text, or a code or a link, each drawn its own way. */
export type Word = string | { code: string } | { link: string; href: string }

export type Words = Word[]
