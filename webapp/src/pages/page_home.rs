use crate::prelude::*;

pub(crate) fn page_index(contexts: Contexts) -> Html {
    push_state("/home");
    page_home(contexts)
}

/// App home page
pub(crate) fn page_home(_contexts: Contexts) -> Html {
    set_title("Home");
    let tags = get_markdown_tags();
    html! {
        <>
            <MarkdownContent href="https://cdn.myfi.ws/d/en-US/under_construction.md" {tags} />
            <NextPageButton url="/about" />
        </>
    }
}
