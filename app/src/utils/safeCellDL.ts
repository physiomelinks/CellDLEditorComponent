// Making a CellDL document from somewhere untrusted, such as a link, safe to open: it must be an SVG document, and
// nothing in it may run once the editor puts it on the page.

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

// The `<metadata>` element holding a CellDL document's RDF
const CELLDL_METADATA_ID = 'celldl-rdf-metadata'

// Elements that run code or embed other documents, which a CellDL diagram never has
const UNSAFE_ELEMENTS = ['script', 'foreignObject', 'iframe', 'object', 'embed', 'handler', 'listener']

// Attributes that hold a link
const LINK_ATTRIBUTES = ['href', 'xlink:href', 'src', 'action', 'formaction']

// A link that's safe to keep: a fragment, http(s), or an image as data (an SVG image runs no scripts)
function safeLink(value: string): boolean {
    const link = value.replace(/[\s\u0000-\u001f]+/g, '').toLowerCase()
    return !/^[a-z][a-z0-9+.-]*:/.test(link)
        || /^https?:/.test(link)
        || /^data:image\//.test(link)
}

// Whether an animation would set an attribute to run code or follow a link
function unsafeAnimation(element: Element): boolean {
    const name = (element.getAttribute('attributeName') ?? '').toLowerCase()
    return name.startsWith('on') || LINK_ATTRIBUTES.includes(name)
}

// The CellDL document `text` without anything that would run when shown; throws an Error if it isn't a CellDL SVG document
export function safeCellDL(text: string): string {
    const svgDocument = new DOMParser().parseFromString(text, 'image/svg+xml')
    const root = svgDocument.documentElement
    if (svgDocument.getElementsByTagName('parsererror').length
     || root.namespaceURI !== SVG_NAMESPACE || root.localName !== 'svg'
     || root.querySelector(`metadata#${CELLDL_METADATA_ID}`) === null) {
        throw new Error('the link is not a CellDL document')
    }
    // Such as an `<?xml-stylesheet?>`, which would load a stylesheet
    for (const node of Array.from(svgDocument.childNodes)) {
        if (node.nodeType === Node.PROCESSING_INSTRUCTION_NODE) {
            node.remove()
        }
    }
    for (const element of Array.from(svgDocument.querySelectorAll('*'))) {
        if (UNSAFE_ELEMENTS.includes(element.localName)
         || (['set', 'animate'].includes(element.localName) && unsafeAnimation(element))) {
            element.remove()
            continue
        }
        for (const attribute of Array.from(element.attributes)) {
            const name = attribute.name.toLowerCase()
            if (name.startsWith('on')
             || (LINK_ATTRIBUTES.includes(name) || attribute.localName === 'href') && !safeLink(attribute.value)) {
                element.removeAttributeNode(attribute)
            }
        }
    }
    return new XMLSerializer().serializeToString(svgDocument)
}
