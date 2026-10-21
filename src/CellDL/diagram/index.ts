/******************************************************************************

CellDL Editor

Copyright (c) 2022 - 2025 David Brooks

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

******************************************************************************/

import * as $rdf from '@celldl/rdf'
import {
    DCT,
    type NamedNode,
    OWL,
    RDF
} from '@celldl/rdf'
import {
    CELLDL,
    MetadataPropertiesMap,
    type MetadataPropertyValue,
    MetadataStore,
} from '@celldl/metadata'

//==============================================================================

import type { PointLike } from '#root/utils/points'
import {
    CELLDL_BACKGROUND_CLASS,
    CellDLStylesheet,
    CONNECTION_COLOUR,
    OLD_CONNECTION_COLOUR
} from '#root/utils/styling'
import { svgCircleElement, SVG_URI, svgRectElement } from '#root/utils/svgUtils'
import type { Constructor, StringProperties } from '#root/utils/types'
import type { Bounds, Extent } from '#editor/geometry'
import { ShapeIntersections } from '#editor/geometry/intersections'
import { CellDLSpatialIndex } from '#editor/geometry/spatialindex'
import type { ContainedObject } from '#editor/geometry/spatialindex'
import { lengthToPixels } from '#editor/geometry/units'
import { type FoundPoint, PointFinder } from '#editor/geometry/pathutils'

import {
    CellDLAnnotation,
    CellDLComponent,
    CellDLConduit,
    type CellDLConnectedObject,
    CellDLConnection,
    CellDLCompartment,
    CellDLInterface,
    type CellDLObject,
    CELLDL_STYLE_CLASS,
    CellDLUnconnectedPort
} from '#editor/celldlObjects'

import { setInternalIds } from '#editor/SVGElements'
import type { BoundedElement } from '#editor/SVGElements/boundedelement'
import { createCompartmentSvgElement } from '#editor/SVGElements/utils/compartment'
import type { SvgConnection } from '#editor/SVGElements/svgconnection'

import { type CellDLEditor, notifyChanges } from '#editor/editor'
import { editGuides } from '#editor/editor/editguides'
import { undoRedo, type UndoState } from '#editor/diagram/undoredo'

import type { ObjectTemplate } from '#editor/components'

import { componentLibraryPlugin } from '#root/plugins'

//==============================================================================

export const CELLDL_VERSION = '1.0'

//==============================================================================

function DIAGRAM_METADATA() {
    return {
        author: DCT.uri('creator'),
        created: DCT.uri('created'),
        description: DCT.uri('description'),
        modified: DCT.uri('modified'),
        title: DCT.uri('title'),
        celldlVersion: OWL.uri('versionInfo')
    }
}

//==============================================================================

const NEW_DIAGRAM_URI = 'file:///tmp/new_file.celldl'

//==============================================================================

// These ids need to come from a schema for CellDL files...
const CELLDL_DEFINITIONS_ID = 'celldl-svg-definitions'
const CELLDL_METADATA_ID = 'celldl-rdf-metadata'
const CELLDL_STYLESHEET_ID = 'celldl-svg-stylesheet'

const DIAGRAM_MARGIN = 20

//==============================================================================

const CELLDL_DIAGRAM_ID = 'celldl-diagram-layer'

const ID_PREFIX = 'ID-'
export const ID_PART_SEPARATOR = '-'

type AddObjectOptions = {
    atBack?: boolean
    hasId?: boolean
}
//==============================================================================

export class CellDLDiagram {
    #svgDiagram!: SVGSVGElement
    #defsElement: SVGDefsElement|null|undefined

    #kb = new MetadataStore()
    #celldlEditor: CellDLEditor

    #documentNode: NamedNode
    #documentNS: $rdf.NamespacedUri
    #filePath: string

    #diagramMetadata: Record<string, NamedNode>
    #diagramProperties: StringProperties = {}

    #currentLayer: SVGGElement | null = null
    #imported: boolean
    #lastIdentifier: number = 0
    #layers: Map<string, SVGGElement> = new Map()
    #objects: Map<string, CellDLObject> = new Map()
    #orderedLayerIds: string[] = []
    #spatialIndex = new CellDLSpatialIndex()

    constructor(filePath: string, celldlData: string, celldlEditor: CellDLEditor, importSvg: boolean = false) {
        this.#diagramMetadata = DIAGRAM_METADATA()
        this.#filePath = filePath
        this.#celldlEditor = celldlEditor
        this.#imported = importSvg
        if (this.#filePath !== '') {
            let documentUri = encodeURI(this.#filePath)
            if (
                !documentUri.startsWith('file:') &&
                !documentUri.startsWith('http:') &&
                !documentUri.startsWith('https:')
            ) {
                documentUri = `file://${documentUri}`
            }
            this.#documentNode = $rdf.namedNode(documentUri)
            this.#documentNS = new $rdf.NamespacedUri('', `${documentUri}#`)
            this.#loadCellDL(celldlData)
            this.#loadMetadata()
        } else {
            this.#documentNode = $rdf.namedNode(NEW_DIAGRAM_URI)
            this.#documentNS = new $rdf.NamespacedUri('', `${NEW_DIAGRAM_URI}#`)
            if (importSvg) {
                this.#importSvg(celldlData)
            } else {
                this.#newDiagram()
            }
            this.#initaliseMetadata()
        }
        this.#setLastIdentifier()
        this.#setupDefines()
        this.#setStylesheet()
        componentLibraryPlugin.openDiagram(this.#documentNode.uri, this.#kb)
    }

    finishSetup() {
        // Called when the loaded diagram has been drawn as SVG
        this.#loadComponents()
        this.#loadInterfaces()
        this.#loadConduits()
        this.#loadConnections()
        this.#loadAnnotations()
        if (this.#imported) {
            // We want the file to be flagged as modified
            notifyChanges()
        }
    }

    async edit() {
        await this.#celldlEditor.editDiagram(this)
    }

    get editorFrame() {
        return this.#celldlEditor.editorFrame
    }

    get metadata(): StringProperties {
        return Object.keys(this.#diagramProperties)
            .filter((key) => key in this.#diagramMetadata)
            .reduce((obj: StringProperties, key: string) => {
                // biome-ignore lint/style/noNonNullAssertion: `key` is in `diagramProperties`
                obj[key] = this.#diagramProperties[key]!
                return obj
            }, {})
    }
    set metadata(data: StringProperties) {
        Object.keys(data)
            .filter((key) => key in this.#diagramMetadata)
            .forEach((key) => {
                // @ts-expect-error: `key` is a valid key for `data`
                this.#diagramProperties[key] = data[key]
            })
        notifyChanges()
    }

    get rdfStore() {
        return this.#kb
    }

    get svgDiagram() {
        return this.#svgDiagram
    }

    get uri(): string {
        return this.#documentNode.value
    }

    domToSvgCoords(domCoords: PointLike): DOMPoint {
        // Transform from screen coordinates to SVG coordinates
        const dom_to_svg_transform: DOMMatrix | undefined = this.#svgDiagram?.getScreenCTM()?.inverse()
        return DOMPoint.fromPoint(domCoords).matrixTransform(dom_to_svg_transform)
    }

    svgToDomCoords(svgCoords: PointLike): DOMPoint {
        // Transform from SVG coordinates to screen coordinates
        const svg_to_dom_transform: DOMMatrix | undefined = this.#svgDiagram?.getScreenCTM() as DOMMatrix
        return DOMPoint.fromPoint(svgCoords).matrixTransform(svg_to_dom_transform)
    }

    makeUri(id: string): NamedNode {
        return this.#documentNS.uri(id)
    }

    #nextIdentifier(): string {
        this.#lastIdentifier += 1
        return `${ID_PREFIX}${this.#lastIdentifier.toString().padStart(8, '0')}`
    }

    removeKnowledge(subject: NamedNode, predicates: NamedNode[]) {
        for (const predicate of predicates) {
            for (const stmt of this.#kb.statementsMatching(subject, predicate, null)) {
                if ($rdf.isBlankNode(stmt.object)) {
                    // @ts-expect-error: `stmt.object` is a BlankNode
                    this.#kb.removeStatementsMatching(stmt.object, null, null)
                }
            }
            this.#kb.removeStatementsMatching(subject, predicate, null)
        }
    }

    #loadDiagramProperties() {
        for (const [key, property] of Object.entries(this.#diagramMetadata)) {
            for (const stmt of this.#kb.statementsMatching(this.#documentNode, property, null)) {
                this.#diagramProperties[key] = stmt.object.value
                break
            }
        }
    }

    #saveDiagramProperties(touchModified: boolean = true) {
        if (!('created' in this.#diagramProperties)) {
            this.#diagramProperties.created = new Date(Date.now()).toISOString()
        } else if (touchModified) {
            this.#diagramProperties.modified = new Date(Date.now()).toISOString()
        }
        for (const [key, property] of Object.entries(this.#diagramMetadata)) {
            this.#kb.removeStatementsMatching(this.#documentNode, property, null)
            if (key in this.#diagramProperties) {
                const value = this.#diagramProperties[key]
                if (value && this.#documentNode) {
                    this.#kb.add(this.#documentNode, property, $rdf.literal(value))
                }
            }
        }
    }

    #setLastIdentifier() {
        const elementsWithId = this.#svgDiagram.querySelectorAll(`[id]`)
        for (let index = 0; index < elementsWithId.length; ++index) {
            // biome-ignore lint/style/noNonNullAssertion: `index` is in range
            const element = elementsWithId[index]!
            if (element.id.startsWith(ID_PREFIX)) {
                const parts = element.id.substring(ID_PREFIX.length).split(ID_PART_SEPARATOR)
                if (parts.length) {
                    // @ts-expect-error:
                    const lastIdentifier = +parts[0]
                    if (lastIdentifier > this.#lastIdentifier) {
                        this.#lastIdentifier = lastIdentifier
                    }
                }
            }
        }
    }

    #setupDefines() {
        // Make sure there is a <defs> and it has a arrow markers for connections
        // (and also a `free-end-connector` ??)
        this.#defsElement = this.#svgDiagram.getElementById(CELLDL_DEFINITIONS_ID) as SVGDefsElement
        if (this.#defsElement === null) {
            this.#svgDiagram.insertAdjacentHTML('afterbegin', `<defs></defs>`)
            this.#defsElement = this.#svgDiagram.firstChild as SVGDefsElement
            this.#defsElement.id = CELLDL_DEFINITIONS_ID
            this.#defsElement.insertAdjacentHTML('afterbegin', componentLibraryPlugin.svgDefinitions())
        }
    }

    #setStylesheet() {
        const css = `${CellDLStylesheet}${componentLibraryPlugin.styleRules()}`
        let styleElement = this.#svgDiagram.querySelector(
            `defs#${CELLDL_DEFINITIONS_ID} > style#${CELLDL_STYLESHEET_ID}`
        )
        if (styleElement === null) {
            styleElement = document.createElementNS(SVG_URI, 'style')
            styleElement.id = CELLDL_STYLESHEET_ID
            this.#defsElement?.prepend(styleElement)
            styleElement.textContent = css
        }
    }

    addDefinition(definitionId: string, definition: string) {
        const defn = this.#defsElement?.querySelector(`#${definitionId}`)
        if (defn) {
            this.#defsElement?.removeChild(defn)
        }
        this.#defsElement?.insertAdjacentHTML('beforeend', definition)
        const element = this.#defsElement?.lastChild
        if (element) {
            element.setAttribute('id', definitionId)
        }
    }

    removeDefinition(definitionId: string) {
        const defn = this.#defsElement?.querySelector(`#${definitionId}`)
        if (defn) {
            this.#defsElement?.removeChild(defn)
        }
    }

    objectById(id: string): CellDLObject | null {
        return this.#objects.get(id) || null
    }

    #saveMetadata(svgDiagram: SVGSVGElement, metadata: string) {
        let metadataElement = svgDiagram.getElementById(CELLDL_METADATA_ID) as SVGMetadataElement
        if (metadataElement === null) {
            svgDiagram.insertAdjacentHTML('afterbegin', `<metadata id="${CELLDL_METADATA_ID}"></metadata>`)
            metadataElement = svgDiagram.getElementById(CELLDL_METADATA_ID) as SVGMetadataElement
        }
        const parser = new DOMParser()
        const xmlDocument = parser.parseFromString('<xml></xml>', 'application/xml')
        const metadataContent = xmlDocument.createCDATASection(metadata)
        metadataElement.replaceChildren(metadataContent)
        metadataElement.dataset.contentType = $rdf.TurtleContentType
    }

    #importSvg(svgData: string) {
        this.#loadSvgDiagram(svgData)

        // Put all existing content into group with class of CELLDL_BACKGROUND_CLASS
        let backgroundGroup: SVGGraphicsElement | null | undefined
        const backgroundElements: SVGGraphicsElement[] = []
        const children = this.#svgDiagram.children
        for (let index = 0; index < children.length; ++index) {
            // biome-ignore lint/style/noNonNullAssertion: index is in range
            const child = children[index]!
            if (child.tagName !== 'defs') {
                backgroundElements.push(child as SVGGraphicsElement)
                if (child.tagName === 'g' && backgroundGroup === undefined) {
                    backgroundGroup = child as SVGGraphicsElement
                } else {
                    backgroundGroup = null
                }
            }
        }
        if (!backgroundGroup) {
            backgroundGroup = document.createElementNS(SVG_URI, 'g')
            this.#svgDiagram.appendChild(backgroundGroup)
            for (const child of backgroundElements) {
                backgroundGroup.appendChild(child)
            }
        }
        backgroundGroup.setAttribute('class', CELLDL_BACKGROUND_CLASS)
        this.#setLayer(CELLDL_DIAGRAM_ID)
    }

    #loadCellDL(celldlData: string) {
        this.#loadSvgDiagram(celldlData)
        this.#findLayers()
        this.#setLayer(CELLDL_DIAGRAM_ID)
    }

    #loadSvgDiagram(svgData: string) {
        const parser = new DOMParser()
        const svgDocument = parser.parseFromString(svgData, 'image/svg+xml')
        const svgDiagram = <SVGSVGElement>svgDocument.firstElementChild
        if (svgDiagram.hasAttribute('width') && svgDiagram.hasAttribute('height')) {
            const width = lengthToPixels(<string>svgDiagram.getAttribute('width'))
            const height = lengthToPixels(<string>svgDiagram.getAttribute('height'))
            if (width !== null && height !== null) {
                svgDiagram.attributes.removeNamedItem('width')
                svgDiagram.attributes.removeNamedItem('height')
                if (!svgDiagram.hasAttribute('viewBox')) {
                    svgDiagram.setAttribute('viewBox', `0 0 ${width} ${height}`)
                }
            }
        }
        // Tweak the colour of <path> elements in existing CellDL files so they show
        // better in dark mode.
        const strokedPaths = svgDiagram.querySelectorAll(`path[stroke="${OLD_CONNECTION_COLOUR}"]`)
        for (let index = 0; index < strokedPaths.length; ++index) {
            // biome-ignore lint/style/noNonNullAssertion: `index` is in range
            const path = strokedPaths[index]!
            path.setAttribute('stroke', CONNECTION_COLOUR)
        }
        this.#svgDiagram = svgDiagram
    }

    #newDiagram() {
        const windowSize = this.#celldlEditor.windowSize
        const svgDiagram = document.createElementNS(SVG_URI, 'svg')

        // centre diagram
        svgDiagram.setAttribute('viewBox', `${-windowSize[0]/2} ${-windowSize[1]/2} ${windowSize[0]} ${windowSize[1]}`)
        this.#svgDiagram = svgDiagram
        this.#setLayer(CELLDL_DIAGRAM_ID)
    }

    #setLayer(layerId: string) {
        let newLayer = <SVGGElement>this.#svgDiagram.querySelector(`svg > g.${CELLDL_STYLE_CLASS.Layer}[id="${layerId}"]`)
        if (newLayer === null) {
            newLayer = document.createElementNS(SVG_URI, 'g')
            newLayer.id = layerId
            newLayer.setAttribute('class', CELLDL_STYLE_CLASS.Layer)
            this.#svgDiagram.appendChild(newLayer)
            this.#layers.set(layerId, newLayer)
            this.#orderedLayerIds.push(layerId)
        }
        this.#currentLayer = newLayer
    }

    #findLayers() {
        const layersWithId = this.#svgDiagram.querySelectorAll(`g.${CELLDL_STYLE_CLASS.Layer}[id]`)
        for (let index = 0; index < layersWithId.length; index += 1) {
            // biome-ignore lint/style/noNonNullAssertion: `index` is in range
            const layer = layersWithId[index]!
            this.#layers.set(layer.id, <SVGGElement>layer)
            this.#orderedLayerIds.push(layer.id)
        }
    }

    #initaliseMetadata() {
        this.#kb.add(this.#documentNode, RDF.uri('type'), CELLDL.uri('Document'))
        this.#diagramProperties.celldlVersion = CELLDL_VERSION
    }

    #loadMetadata() {
        const metadataElement = this.#svgDiagram.getElementById(CELLDL_METADATA_ID) as SVGMetadataElement
        if (
            metadataElement &&
            (!('contentType' in metadataElement.dataset) || metadataElement.dataset.contentType === $rdf.TurtleContentType)
        ) {
            const childNodes = metadataElement.childNodes
            for (let index = 0; index < childNodes.length; ++index) {
                // biome-ignore lint/style/noNonNullAssertion: index is in range
                const childNode = childNodes[index]!
                if (childNode.nodeName === '#cdata-section') {
                    this.#kb.load(this.#documentNode.uri, (<CDATASection>childNode).data, $rdf.TurtleContentType)
                    break
                }
            }
        }
        if (!this.#kb.contains(this.#documentNode, RDF.uri('type'), CELLDL.uri('Document'))) {
            throw new Error(`${this.#filePath} metadata doesn't describe a valid CellDL document`)
        }
        this.#loadDiagramProperties()
        if ('celldlVersion' in this.#diagramProperties) {
            if (this.#diagramProperties.celldlVersion !== CELLDL_VERSION) {
                throw new Error(
                    `${this.#filePath} metadata version ${this.#diagramProperties.celldlVersion} is not compatible with editor`
                )
            }
        } else {
            this.#diagramProperties.celldlVersion = CELLDL_VERSION
        }
    }

    #trimSVGDiagram(svgDiagram: SVGSVGElement): Extent | null {
        const bounds = (<SVGGraphicsElement[]>(
            Array.from(svgDiagram.children).filter(
                (child) => 'getBBox' in child && !child.classList.contains('editor-specific')
            )
        ))
            .map((child) => child.getBBox())
            .reduce(
                (bounds, bbox) => {
                    return bbox.width > 0 && bbox.height > 0
                        ? {
                              xMin: Math.min(bounds.xMin, bbox.x),
                              xMax: Math.max(bounds.xMax, bbox.x + bbox.width),
                              yMin: Math.min(bounds.yMin, bbox.y),
                              yMax: Math.max(bounds.yMax, bbox.y + bbox.height)
                          }
                        : bounds
                },
                {
                    xMin: Infinity,
                    xMax: -Infinity,
                    yMin: Infinity,
                    yMax: -Infinity
                }
            )
        const roundUp10 = (x: number) => 10 * Math.ceil(x / 10)
        const roundDn10 = (x: number) => 10 * Math.floor(x / 10)
        if (bounds.xMin < bounds.xMax && bounds.yMin < bounds.yMax) {
            const xLeft = roundDn10(bounds.xMin - DIAGRAM_MARGIN)
            const xRight = roundUp10(bounds.xMax + DIAGRAM_MARGIN)
            const yTop = roundDn10(bounds.yMin - DIAGRAM_MARGIN)
            const yBottom = roundUp10(bounds.yMax + DIAGRAM_MARGIN)
            return [
                xLeft, yTop,
                xRight - xLeft, yBottom - yTop
            ]
        }
        return null
    }

    export(format: string) {
        return {
            error: `Unsupported export format: ${format}`
        }
    }

    async serialise(): Promise<string> {
        if (this.#svgDiagram !== null) {
            // Remove active/selected class from elements
            this.#celldlEditor.resetObjectStates()

            // Clone our diagram and remove editor specific elements from the SVG
            const svgDiagram = this.#svgDiagram.cloneNode(true) as SVGSVGElement
            svgDiagram.removeAttribute('style')
            this.#removeEditorElements(svgDiagram)

            // Remove extraneous whitespace around the diagram
            const trimmedViewbox = this.#trimSVGDiagram(this.#svgDiagram)
            if (trimmedViewbox) {
                svgDiagram.setAttribute('viewBox', trimmedViewbox.map((n) => String(n)).join(' '))
            }

            // Add statements about the document from plugins
            componentLibraryPlugin.addPluginMetadataToStore(this.rdfStore)

            // Make sure metadata is up-to-date
            this.#saveDiagramProperties()

            // Serialise metadata as Turtle into CDATA section in <metadata> element
            const metadata: string = await this.#serialiseMetadata($rdf.TurtleContentType)
            if (metadata !== '') {
                this.#saveMetadata(svgDiagram, metadata)
            }

            // Serialise the actual diagram
            const svgSerializer = new XMLSerializer()
            const svgData = svgSerializer.serializeToString(svgDiagram)
            return svgData
        }
        return ''
    }

    /**
     * The diagram's metadata as Turtle, as `serialise()` embeds it in `<metadata>`,
     * but without changing selection or the `modified` timestamp.
     */
    async rdf(): Promise<string> {
        if (!this.#svgDiagram) {
            return ''
        }
        componentLibraryPlugin.addPluginMetadataToStore(this.rdfStore)
        this.#saveDiagramProperties(false)
        return await this.#serialiseMetadata($rdf.TurtleContentType)
    }

    async #serialiseMetadata(metadataFormat: $rdf.ContentType): Promise<string> {
        let metadata: string = ''
        try {
            metadata = await this.#kb.serialise(this.#documentNode.uri, metadataFormat, $rdf.namespaceMap.namespaces)
        } catch (err) {
            console.log(err)
        }
        return metadata
    }

    #setUniqueId(svgElement: SVGGraphicsElement) {
        svgElement.id = this.#nextIdentifier()
        setInternalIds(svgElement)
    }

    addEditorElement(element: SVGElement, prepend = false) {
        if (prepend) {
            this.#svgDiagram.prepend(element)
        } else {
            this.#svgDiagram.append(element)
        }
        element.classList.add('editor-specific')
    }

    #removeEditorElements(svgDiagram: SVGSVGElement) {
        // We save matched elements as an array because ``getElementsByClassName()``
        // returns a live collection
        const editorSpecificElements = Array.from(svgDiagram.getElementsByClassName('editor-specific'))
        for (const element of editorSpecificElements) {
            element.remove()
        }
    }

    associatedObjects(object: CellDLObject): CellDLObject[] {
        const objects: CellDLObject[] = []
        for (const associated of this.#associatedObjects(object)) {
            if (associated?.svgElement) {
                objects.push(associated)
            }
        }
        return objects
    }

    #associatedObjects(object: CellDLObject | undefined): Set<CellDLObject> {
        if (!object) {
            return new Set() as Set<CellDLObject>
        } else if (object.isConnection) {
             return new Set((<CellDLConnection>object).connectedObjects) as Set<CellDLObject>
        } else if (object.isConnectable) {
            return new Set((<CellDLConnectedObject>object).connections.values())
        } else {
            return new Set() as Set<CellDLObject>
        }
    }

    #addMoveableObject(object: CellDLObject) {
        this.#objects.set(object.id, object)
        this.#spatialIndex.add(object)
        if (object.hasEditGuides) {
            editGuides.addGuide(<CellDLComponent>object)
        }
        componentLibraryPlugin.addComponent(object)
    }

    #addConnection(connection: CellDLConnection) {
        this.#objects.set(connection.id, connection)
    }

    addConnectedObject(svgElement: SVGGraphicsElement, template: ObjectTemplate): CellDLConnectedObject | null {
        const object = this.#addNewObject(svgElement, template)
        this.#addMoveableObject(object)
        notifyChanges()
        return object as CellDLConnectedObject
    }

    addNewConnection(svgElement: SVGGraphicsElement, template: ObjectTemplate): CellDLConnection {
        const connection = this.#addNewObject(svgElement, template) as CellDLConnection
        // let the plugins know
        componentLibraryPlugin.addConnection(connection)
        notifyChanges()
        return connection
    }

    makeCompartment(bounds: Bounds): CellDLCompartment {
        const cornerPoints = bounds.asPoints()
        const svgElement = createCompartmentSvgElement(this.#nextIdentifier(),
                                                cornerPoints[0], cornerPoints[1])
        const compartmentObject = this.#addNewObject(
            svgElement, {
                CellDLClass: CellDLCompartment,
                metadataProperties: MetadataPropertiesMap.fromProperties([])
            },
            {
                atBack: true,
                hasId: true
            }
        ) as CellDLCompartment
        if (compartmentObject) {
            this.#addMoveableObject(compartmentObject)
        }
        notifyChanges()
        return compartmentObject
    }

    groupComponents(bounds: Bounds, objects: CellDLObject[]): CellDLComponent {
        const componentGroup = document.createElementNS(SVG_URI, 'g')
        componentGroup.id = this.#nextIdentifier()
        const cornerPoints = bounds.asPoints()
        const componentRect = svgRectElement(cornerPoints[0], cornerPoints[1], { class: 'compartment' })
        const componentIntersections = new ShapeIntersections(componentRect)
        componentGroup.appendChild(componentRect)
        const objectIds = new Set(objects.map((obj) => obj.id))
        const interfacePorts: CellDLInterface[] = []
        for (const object of objects) {
            if (
                !object.isConnection ||
                objectIds.isSupersetOf(new Set((<CellDLConnection>object).connectedObjects.map((obj) => obj.id)))
            ) {
                // Component or connection all inside bounds
                // biome-ignore lint/style/noNonNullAssertion: object has a celldlSvgElement
                componentGroup.appendChild(object.celldlSvgElement!.svgElement)
                if (!object.isConnection) {
                    this.#spatialIndex.remove(object)
                }
            } else {
                // Connection that crosses the component group's boundary
                const connectionPorts = this.#addConnectionToComponent(
                    componentGroup,
                    componentIntersections,
                    objectIds,
                    <CellDLConnection>object
                )
                interfacePorts.push(...connectionPorts)
            }
        }
        const component = this.#addNewObject(
            componentGroup, {
                CellDLClass: CellDLComponent,
                metadataProperties: MetadataPropertiesMap.fromProperties([
                    [CELLDL.uri('hasInterface'), interfacePorts.map((p) => p.uri)]
                ])
            },
            { hasId: true }
        ) as CellDLComponent
        if (component) {
            this.#addMoveableObject(component)
        }
        notifyChanges()
        return component
    }

    #createConnection(connectedObjects: CellDLConnectedObject[], svgElements: SVGGraphicsElement[]): CellDLConnection|undefined {
        let svgElement: SVGGraphicsElement
        if (svgElements.length === 0) {
            console.log('No SVG elements to connect...')
            return
        }
        if (svgElements.length > 1) {
            svgElement = document.createElementNS(SVG_URI, 'g')
            svgElement.classList.add(CELLDL_STYLE_CLASS.Connection)
            svgElements.forEach((element) => { element.classList.add('parent-id') })
            svgElements.forEach((element) => { element.classList.remove('selected') })
            svgElements.forEach((element) => { svgElement.appendChild(element) })
        } else {
            // biome-ignore lint/style/noNonNullAssertion: `svgElements` is one long`
            svgElement = svgElements[0]!
            svgElement.classList.remove('parent-id', 'selected')
        }
        if (!svgElement.hasAttribute('id')) {
            svgElement.setAttribute('id', this.#nextIdentifier())
        }
        // what ComponentPlugin was used to create the object?
        const metadataProperties = MetadataPropertiesMap.fromProperties([
            // biome-ignore lint/style/noNonNullAssertion: `connectObjects` is at least two long
            [CELLDL.uri('hasSource'), connectedObjects[0]!.uri],
            // biome-ignore lint/style/noNonNullAssertion: index is in range
            [CELLDL.uri('hasTarget'), connectedObjects[connectedObjects.length - 1]!.uri],
            [CELLDL.uri('hasIntermediate'), connectedObjects.slice(1, -1).map((c) => c.uri)]
        ])
        const connection = this.#addNewObject(
            svgElement, {
                CellDLClass: CellDLConnection,
                metadataProperties
            },
            { hasId: true }
        ) as CellDLConnection
        this.#addConnection(connection)
        // let the plugins know
        componentLibraryPlugin.addConnection(connection)
        return connection
    }

    #createPort<T extends CellDLConnectedObject>(newObjectClass: typeof CellDLInterface | typeof CellDLUnconnectedPort, point: PointLike): T {
        const connector = this.#addNewObject(
            svgCircleElement(point, 0, { id: this.#nextIdentifier() }), {
                CellDLClass: newObjectClass,
                metadataProperties: new MetadataPropertiesMap()
            },
            { hasId: true }
        ) as T
        this.#addMoveableObject(connector as CellDLObject)
        return connector
    }

    createInterfacePort(point: PointLike): CellDLInterface {
        return this.#createPort<CellDLInterface>(CellDLInterface, point)
    }

    createUnconnectedPort(point: PointLike): CellDLUnconnectedPort {
        return this.#createPort<CellDLUnconnectedPort>(CellDLUnconnectedPort, point)
    }

    #addConnectionToComponent(
        componentGroup: SVGGElement,
        componentIntersections: ShapeIntersections,
        objectIds: Set<string>,
        connection: CellDLConnection
    ): CellDLInterface[] {
        // The connection might intersect the compartment's boundary multiple times, once
        // for each path element, resulting in multiple new connections, both inside and
        // outside of the new compartment. e.g:
        //
        //             =========================
        //            ||                       ||
        //            ||   +----R   R-----+    ||
        //             ====1====2===3=====4=====
        //                 |    R---+     |
        //                 |              |
        //                 A              B
        //
        //   Connection [A, R, R, R, B] would become:
        //
        //      [1, R, 2], [3, R, 4] inside
        //      [A, 1], [2, R, 3], [4, B] outside
        //
        //  and:
        //                 +-------K------+
        //                 R              R
        //                 |              |
        //             ====1==============2=====
        //            ||   |              |    ||
        //            ||   A              B    ||
        //             =========================
        //
        //   Connection [A, R, K, B] would become:
        //
        //      [A, 1], [2, B] inside
        //      [1, R, K, R, 2] outside
        //
        const interfacePorts: CellDLInterface[] = []
        const connectors = connection.connectedObjects
        const pathElements = (<SvgConnection>connection.celldlSvgElement).pathElements
        const pathStart = connectors[0] as CellDLConnectedObject
        const newConnectors: CellDLConnectedObject[] = []
        newConnectors.push(pathStart)
        const newElements: SVGPathElement[] = []

        // The connection will be split into several, so first remove the original one
        this.removeObject(connection)

        let currentPathInside = objectIds.has(pathStart.id)
        let pathEnd: CellDLConnectedObject
        for (let pathElementIndex = 0; pathElementIndex < pathElements.length; pathElementIndex += 1) {
            // biome-ignore lint/style/noNonNullAssertion: index is in range
            const pathElement = pathElements[pathElementIndex]!
            // biome-ignore lint/style/noNonNullAssertion: index is in range
            pathEnd = connectors[pathElementIndex + 1]!
            if (
                (currentPathInside && objectIds.has(pathEnd.id)) ||
                (!currentPathInside && !objectIds.has(pathEnd.id))
            ) {
                newConnectors.push(pathEnd)
                newElements.push(pathElement.svgElement)
                continue
            }
            const pathIntersections = componentIntersections.intersections(pathElement.svgElement)
            if (pathIntersections.length % 2 === 0) {
                console.warn(`Path unexpectedly intersects selection boundary...`)
            } else {
                let splitPoint: FoundPoint | null = null
                let closestOffset = currentPathInside ? -Infinity : Infinity
                const pointFinder = new PointFinder(pathElement.pathArray)
                // We use the pathElement's intersection which is closest to the inside end
                // for the new interface's location
                for (const point of pathIntersections) {
                    const foundPoint = pointFinder.findPoint(point)
                    if (
                        foundPoint.offset !== null &&
                        ((!currentPathInside && foundPoint.offset < closestOffset) ||
                            (currentPathInside && foundPoint.offset > closestOffset))
                    ) {
                        closestOffset = foundPoint.offset
                        splitPoint = foundPoint
                    }
                }
                if (splitPoint === null) {
                    console.warn(`Path unexpectedly doesn't intersect selection boundary...`)
                } else {
                    // Create an Interface at the split point
                    const interfacePort = this.createInterfacePort(splitPoint.point)
                    interfacePorts.push(interfacePort)
                    newConnectors.push(interfacePort)
                    const interfaceElement = <BoundedElement>interfacePort.celldlSvgElement
                    componentGroup.appendChild(interfaceElement.svgElement)
                    const tailSvgElement = pathElement.splitPath(splitPoint, interfaceElement)
                    const headSvgElement = pathElement.svgElement.cloneNode(true) as SVGPathElement
                    headSvgElement.removeAttribute('id')
                    newElements.push(headSvgElement)
                    const newConnection = this.#createConnection(newConnectors, newElements)
                    if (newConnection) {
                        this.#connectComponmentConnection(newConnection, componentGroup, currentPathInside)
                    }
                    newConnectors.length = 0
                    newConnectors.push(interfacePort)
                    newConnectors.push(pathEnd)
                    newElements.length = 0
                    newElements.push(tailSvgElement)
                    currentPathInside = !currentPathInside
                }
            }
        }
        if (newConnectors.length) {
            // && newElements.length ?? Or newConnectors.length > 1
            const newConnection = this.#createConnection(newConnectors, newElements)
            if (newConnection) {
                this.#connectComponmentConnection(newConnection, componentGroup, currentPathInside)
            }
        }

        return interfacePorts
    }

    #connectComponmentConnection(
        connection: CellDLConnection,
        componentGroup: SVGGElement,
        currentPathInside: boolean
    ) {
        if (currentPathInside) {
            // biome-ignore lint/style/noNonNullAssertion: connection will have a CellDLSvgElement
            componentGroup.appendChild(connection.celldlSvgElement!.svgElement)
        } else {
            if (connection.source?.isInterface) {
                (<CellDLInterface>connection.source).addExternalConnection(connection)
            }
            if (connection.target?.isInterface) {
                (<CellDLInterface>connection.target).addExternalConnection(connection)
            }
        }
    }

    #addNewObject(svgElement: SVGGraphicsElement, objectTemplate: ObjectTemplate, options: AddObjectOptions={}) {
        const CellDLClass = objectTemplate.CellDLClass
        if (!options?.hasId) {
            this.#setUniqueId(svgElement)
        }
        svgElement.classList.add(CellDLClass.celldlStyleClass)
        if (this.#currentLayer) {
            if (options?.atBack) {
                this.#currentLayer.insertBefore(svgElement, this.#currentLayer.firstChild)
            } else {
                this.#currentLayer.appendChild(svgElement)
            }
        }
        // This is where we create an instanced object of its objectTemplate's class
        const celldlObject = new CellDLClass(this.makeUri(svgElement.id), objectTemplate, this)
        if (celldlObject.isConnection) {
            this.#addConnection(<CellDLConnection>celldlObject)
        }
        celldlObject.assignSvgElement(svgElement, true)
        undoRedo.setInsertUndoState(celldlObject)
        return celldlObject
    }

    #setObjectSvgElement(celldlObject: CellDLObject): boolean {
        const svgElement = <SVGGraphicsElement>this.#svgDiagram.getElementById(celldlObject.id)
        if (svgElement) {
            celldlObject.assignSvgElement(svgElement, false)
            return true
        }
        console.error(`Missing SVG element for ${celldlObject.id}`)
        return false
    }

    #celldlObjectFromRdf<T extends CellDLObject>(CellDLClass: Constructor<T>, subject: $rdf.SubjectType): T {
        const metadata = this.#kb.metadataPropertiesForSubject(subject)
        const objectTemplate = componentLibraryPlugin.getObjectTemplate(subject, metadata, this.#kb)
        return new CellDLClass(subject, objectTemplate, this, false)
    }

    #subjectsOfType(parentType: NamedNode): [$rdf.SubjectType, NamedNode][] {
        return this.#kb.subjectsOfType(parentType).filter((st) => st[0].value.startsWith(this.#documentNode.value))
    }

    #loadObject<T>(type: NamedNode, CellDLClass: T) {
        for (const subjectType of this.#subjectsOfType(type)) {
            if (subjectType[1].equals(type)) {
                const object = this.#celldlObjectFromRdf(CellDLClass as Constructor<CellDLObject>, subjectType[0])
                if (this.#setObjectSvgElement(object)) {
                    this.#addMoveableObject(object)
                }
            }
        }
    }

    #loadAnnotations() {
        this.#loadObject(CELLDL.uri('Annotation'), CellDLAnnotation)
    }

    #loadComponents() {
        this.#loadObject(CELLDL.uri('Component'), CellDLComponent)
        this.#loadObject(CELLDL.uri('Compartment'), CellDLCompartment)
        this.#loadObject(CELLDL.uri('UnconnectedPort'), CellDLUnconnectedPort)
    }

    #loadInterfaces() {
        this.#loadObject(CELLDL.uri('Connector'), CellDLInterface)
    }

    #loadConduits() {
        this.#loadObject(CELLDL.uri('Conduit'), CellDLConduit)
    }

    getConnector(connectorNode: MetadataPropertyValue | null): CellDLConnectedObject | null {
        // @ts-expect-error: `value` property exists on a NamedNode
        if (connectorNode && $rdf.isNamedNode(connectorNode) && connectorNode.value.startsWith(this.#documentNode.value)) {
            const connectorId = (<NamedNode>connectorNode).id()
            const connector = this.#objects.get(connectorId) as CellDLConnectedObject
            return connector?.isConnectable ? connector : null
        }
        return null
    }

    #loadConnections() {
        this.#loadObject(CELLDL.uri('Connection'), CellDLConnection)
    }

    objectsContainedIn(compartment: Bounds): ContainedObject[] {
        return this.#spatialIndex.objectsContainedIn(compartment)
    }

    objectMoved(celldlObject: CellDLObject) {
        this.#spatialIndex.update(celldlObject)
        notifyChanges()
    }

    undoDelete(undoState: UndoState) {
        const connections: CellDLConnection[] = []
        for (const storedObject of undoState.storedObjects.values()) {
            storedObject.restoreSvgElement() // adds SVG element to DOM
            const celldlObject = storedObject.celldlObject
            if (celldlObject.isComponent) {
                editGuides.addGuide(<CellDLComponent>celldlObject)
            }
            this.#objects.set(celldlObject.id, celldlObject)
            this.#kb.addStatementList(storedObject.knowledge)
            if (celldlObject.isConnectable) {
                const component = <CellDLConnectedObject>celldlObject
                const connections = (<CellDLConnectedObject>celldlObject).connections
                for (const connection of connections) {
                    component.addConnection(connection)
                }
                componentLibraryPlugin.addComponent(celldlObject)
            } else if (celldlObject.isConnection) {
                connections.push(celldlObject as CellDLConnection)
            }
            if (storedObject.selected) {
                this.#celldlEditor.selectObject(celldlObject, true)
            }
            this.#spatialIndex.add(celldlObject)
        }
        for (const connection of connections) {
            componentLibraryPlugin.addConnection(connection)
            for (const component of connection.connectedObjects) {
                component.addConnection(connection)
            }
        }
    }

    undoInsert(undoState: UndoState) {
        for (const storedObject of undoState.storedObjects.values()) {
            this.#removeObject(storedObject.celldlObject)
        }
    }

    removeObject(celldlObject: CellDLObject, undoState: UndoState|null=null) {
        if (this.#objects.has(celldlObject.id)) {
            this.#removeObject(celldlObject, undoState)
            notifyChanges()
        }
    }

    #removeObject(celldlObject: CellDLObject, undoState: UndoState|null=null) {
        if (undoState) {
            undoState.storeObject(celldlObject)
        }
        if (celldlObject.isComponent) {
            editGuides.removeGuide(<CellDLComponent>celldlObject)
        }
        celldlObject.celldlSvgElement?.remove() // Will remove SVG element from DOM
        this.#kb.removeStatementsForSubject(celldlObject.uri)
        this.#objects.delete(celldlObject.id)
        this.#spatialIndex.remove(celldlObject)
        if (celldlObject.isConnectable) {
            const component = <CellDLConnectedObject>celldlObject
            for (const connection of component.connections) {
                this.#removeObject(connection, undoState)
                component.deleteConnection(connection)
            }
            componentLibraryPlugin.componentDeleted(component)
        }
        if (celldlObject.isConnection) {
            const connection = <CellDLConnection>celldlObject
            for (const connector of connection.connectedObjects) {
                connector.deleteConnection(connection)
            }
            componentLibraryPlugin.connectionDeleted(connection)
        }
    }
}

//==============================================================================
