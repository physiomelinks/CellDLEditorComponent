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

import { CELLDL, type MetadataPropertiesMap, type MetadataStore } from '@celldl/metadata'
import { DCT, isLiteral, type Literal, type NamedNode, RDF, RDFS } from '@celldl/rdf'

//==============================================================================

import { Point, type PointLike } from '#root/utils/points'

import { alert } from '#editor/editor/alerts'
import { editGuides } from '#editor/editor/editguides'

import { BoundedElement } from '#editor/SVGElements/boundedelement'
import { CompartmentElement } from '#editor/SVGElements/compartmentelement'
import type { ObjectTemplate } from '#editor/components'
import type { CellDLDiagram } from '#editor/diagram'
import { SvgConnection } from '#editor/SVGElements/svgconnection'
import type { CellDLSVGElement, ElementMoveOptions } from '#editor/SVGElements'

import { componentLibraryPlugin } from '#root/plugins'

//==============================================================================

export enum CELLDL_STYLE_CLASS {  // these are SVG styling class names, not types
    Annotation = 'celldl-Annotation',
    Component = 'celldl-Component',
    Connector = 'celldl-Connector',
    Connection = 'celldl-Connection',
    Conduit = 'celldl-Conduit',
    Compartment = 'celldl-Compartment',
    Interface = 'celldl-InterfacePort',
    Layer = 'celldl-Layer',
    UnconnectedPort = 'celldl-Unconnected',
    Unknown = ''
}

//==============================================================================

/*
class BranchPoint implements PointLike {
    x: number = 0.0
    y: number = 0.0
    #connection: CellDLConnection

    // should we not pass in position/offset in range (0.0, 1.0)?
    // and have a separate `setLocation()`??
    constructor(connection: CellDLConnection, x: number, y: number)
    {
        this.#connection = connection
        this.x = x
        this.y = y
    }
}
*/

//==============================================================================

export class CellDLObject {
    static celldlStyleClass: CELLDL_STYLE_CLASS = CELLDL_STYLE_CLASS.Unknown
    static celldlTypeName: string = 'Object'

    #celldlStyleClass: CELLDL_STYLE_CLASS
    #celldlDiagram: CellDLDiagram
    #celldlSvgElement?: CellDLSVGElement
    #celldlTypeName: string

    #description: string|undefined
    #label: string|undefined
    #name: string = ''
    #moveInitialised: boolean = false

    #metadataProperties!: MetadataPropertiesMap
    #objectTemplate: ObjectTemplate|undefined

    #children: Map<string, CellDLObject> = new Map()
    #parents: Map<string, CellDLObject> = new Map()

    #pluginData: Map<string, object> = new Map()

    constructor(
        public readonly uri: NamedNode,
        objectTemplate: ObjectTemplate,
        celldlDiagram: CellDLDiagram,
        updateStore: boolean=true
    ) {
        this.#celldlDiagram = celldlDiagram
        // @ts-expect-error: celldlStyleClass is a member of the object's constructor
        this.#celldlStyleClass = this.constructor.celldlStyleClass
        // @ts-expect-error: celldlType is a member of the object's constructor
        this.#celldlTypeName = this.constructor.celldlTypeName
        this.#objectTemplate = objectTemplate
        this.#name = objectTemplate?.name || ''

        this.#setMetadataProperties(objectTemplate.metadataProperties)

        if (updateStore) {
            celldlDiagram.rdfStore.addMetadataPropertiesForSubject(uri, this.#metadataProperties)
        }

        // Get data that plugins need to associate with the object
        this.#pluginData = componentLibraryPlugin.getPluginData(this)
    }

    toString(): string {
        return `${this.#celldlStyleClass} ${this.id}`
    }

    get celldlStyleClass() {
        return this.#celldlStyleClass
    }

    get celldlDiagram() {
        return this.#celldlDiagram
    }

    get celldlSvgElement() {
        return this.#celldlSvgElement
    }
    setCelldlSvgElement(celldlSvgElement: CellDLSVGElement) {
        this.#celldlSvgElement = celldlSvgElement
    }

    get connections(): CellDLConnection[] {
        return []
    }

    get description() {
        return this.#description
    }

    get hasEditGuides() {
        return false
    }

    get id(): string {
        return this.uri.id()
    }

    isA(rdfType: NamedNode) {
        return CELLDL.uri(this.#celldlTypeName).equals(rdfType) || this.#metadataProperties.isA(rdfType)
    }

    get isAlignable() {
        return true
    }

    get isAnnotation() {
        return this.#celldlTypeName === 'Annotation'
    }

    get isComponent() {
        // Conduits are a component sub-class
        return this.#celldlTypeName === 'Component' || this.#celldlTypeName === 'Conduit'
    }

    get isConduit() {
        return this.#celldlTypeName === 'Conduit'
    }

    get isConnectable() {
        return false
    }

    get isConnection() {
        return this.#celldlTypeName === 'Connection'
    }

    get isCompartment() {
        return this.#celldlTypeName === 'Compartment'
    }

    get isInterface() {
        return this.#celldlTypeName === 'Interface'
    }

    get isMoveable() {
        return false
    }

    get isUnconnectedPort() {
        return this.#celldlTypeName === 'UnconnectedPort'
    }

    get label() {
        return this.#label
    }

    get maxConnections(): number {
        return 0
    }

    // Additional metadata about sub-classed instances
    get metadataProperties() {
        return this.#metadataProperties
    }

    get moveInitialised() {
        return this.#moveInitialised
    }

    get name() {
        return this.#name
    }

    get numConnections(): number {
        return 0
    }

    get objectTemplate() {
        return this.#objectTemplate
    }

    get pluginIds(): string[] {
        return [...this.#pluginData.keys()]
    }

    get rdfStore(): MetadataStore {
        return this.#celldlDiagram.rdfStore
    }

    get selected() {
        return this.#celldlSvgElement?.selected
    }

    get svgElement() {
        return this.#celldlSvgElement?.svgElement || null
    }

    get typeName(): string {
        return this.#celldlTypeName
    }

    pluginData(pluginId: string): object {
        return this.#pluginData.get(pluginId) || {}
    }

    activate(active = true) {
        this.#celldlSvgElement?.activate(active)
    }

    attach(parent: CellDLObject) {
        this.#parents.set(parent.id, parent)
        parent.#children.set(this.id, this)
    }

    containsPoint(point: PointLike): boolean {
        return this.#celldlSvgElement?.containsPoint(point) || false
    }

    initialiseMove(svgElement: SVGGraphicsElement) {
        this.#moveInitialised = this.#celldlSvgElement?.isMoveable(svgElement) || false
        if (this.#moveInitialised) {
            svgElement.style.setProperty('cursor', 'move')
        }
    }

    startMove(svgPoint: PointLike, options: ElementMoveOptions={}) {
        this.#celldlSvgElement?.startMove(svgPoint, options)
    }

    move(svgPoint: PointLike, options: ElementMoveOptions={}) {
        this.#celldlSvgElement?.move(svgPoint, options)
    }

    endMove() {
        this.#celldlSvgElement?.endMove()
    }

    finaliseMove() {
        this.#moveInitialised = false
    }

    reposition(startPosn: PointLike, endPosn: PointLike, options: ElementMoveOptions={}) {
        this.startMove(startPosn, options)
        this.move(endPosn, options)
        this.celldlDiagram.objectMoved(this)
        this.endMove()
    }

    addControlHandle(svgPoint: PointLike): SVGGraphicsElement|undefined {
        return this.#celldlSvgElement?.addControlHandle(svgPoint)
    }

    clearControlHandles() {
        this.#celldlSvgElement?.clearControlHandles()
    }

    drawControlHandles() {
        this.#celldlSvgElement?.drawControlHandles()
    }

    highlight(highlight: boolean=true) {
        this.#celldlSvgElement?.highlight(highlight)
    }

    redraw() {
        if (this.#celldlSvgElement) {
            this.#celldlSvgElement.redraw()
        }
    }

    select(selected: boolean=true) {
        this.#celldlSvgElement?.select(selected)
    }

    setName(name: string) {
        this.#name = name
    }

    assignSvgElement(_svgElement: SVGGraphicsElement, _align: boolean) {
    }

    setDescription(description: string|undefined) {
        this.#description = description
    }

    setLabel(label: string|undefined) {
        this.#label = label
    }

    #setMetadataProperties(properties: MetadataPropertiesMap) {
        // Create a new MetadataPropertiesMap rather than storing a reference
        const metadataProperties = properties.copy()
        metadataProperties.setProperty(RDF.uri('type'), CELLDL.uri(this.#celldlTypeName), true)
        this.#metadataProperties = metadataProperties
        const description = properties.get(DCT.uri('description').value)
        if (description && isLiteral(description)) {
            this.setDescription((description as Literal).value)
        }
        const label = properties.get(RDFS.uri('label').value)
        if (label && isLiteral(label)) {
            this.setLabel((label as Literal).value)
        }
    }
}

//==============================================================================

export class CellDLMoveableObject extends CellDLObject {

    #boundedElement: BoundedElement|undefined

    startMove(svgPoint: PointLike, options: ElementMoveOptions={}) {
        // Finding alignment guides as we move
        editGuides.aligning(this, true)
        super.startMove(svgPoint, options)
    }

    get isMoveable() {
        return true
    }

    move(svgPoint: PointLike, options: ElementMoveOptions={}) {
        super.move(svgPoint, options)
        // Highliglight guides of objects that our centroid's aligned with
        editGuides.matchGuide(this)
    }

    endMove() {
        super.endMove()
        // We've stopped finding our alignment guides
        editGuides.aligning(this, false)
    }

    redraw() {
        super.redraw()
    }

    assignSvgElement(svgElement: SVGGraphicsElement, align: boolean) {
        this.#boundedElement = new BoundedElement(this, svgElement, this.isAlignable, align)
    }
}

//==============================================================================

export class CellDLAnnotation extends CellDLMoveableObject {
    static celldlStyleClass = CELLDL_STYLE_CLASS.Annotation
    static celldlTypeName = 'Annotation'

    get hasEditGuides() {
        return true
    }
}

//==============================================================================

export class CellDLConnectedObject extends CellDLMoveableObject {
    static celldlTypeName = 'Connector'

    #connections: Map<string, CellDLConnection> = new Map()
    #maxConnections: number

    constructor(
        uri: NamedNode,
        objectTemplate: ObjectTemplate,
        celldlDiagram: CellDLDiagram,
        updateStore: boolean=true
    ) {
        super(uri, objectTemplate, celldlDiagram, updateStore)
        this.#maxConnections = componentLibraryPlugin.getMaxConnections(this)
    }

    toString(): string {
        return `${super.toString()}  Connections: ${[...this.#connections.keys()].join(', ')}`
    }

    get connections(): CellDLConnection[] {
        return [...this.#connections.values()]
    }

    get isConnectable() {
        return true
    }

    get maxConnections(): number {
        return this.#maxConnections
    }

    get numConnections(): number {
        return this.#connections.size
    }

    getConnection(id: string): CellDLConnection | null {
        return this.#connections.get(id) || null
    }

    addConnection(connection: CellDLConnection) {
        if (this.numConnections < this.maxConnections) {
            this.#connections.set(connection.id, connection)
        } else {
            alert.elementError(
                `${this.id}: Cannot add ${connection.id} --  connection limit reached`,
                this.celldlSvgElement ? this.celldlSvgElement.svgElement : undefined
            )
        }
    }

    deleteConnection(connection: CellDLConnection) {
        this.#connections.delete(connection.id)
    }

    startMove(svgPoint: PointLike, options: ElementMoveOptions={}) {
        super.startMove(svgPoint, options)
        // Remove control handles from selected connections
        this.#connections.forEach(connection => {
            connection.clearSelectedHandles()
        })
    }

    redraw() {
        super.redraw()
        // Redraw connections that depend on our position
        this.#connections.forEach(connection => {
            connection.redraw()
        })
    }
}

//==============================================================================

export class CellDLComponent extends CellDLConnectedObject {
    static celldlStyleClass = CELLDL_STYLE_CLASS.Component
    static celldlTypeName = 'Component'

    #interfacePorts: CellDLInterface[] = []

    constructor(
        uri: NamedNode,
        objectTemplate: ObjectTemplate,
        celldlDiagram: CellDLDiagram,
        updateStore: boolean=true
    ) {
        super(uri, objectTemplate, celldlDiagram, updateStore)
        this.#interfacePorts = objectTemplate.metadataProperties
            .getPropertyAsArray(CELLDL.uri('hasInterface'))
            .map((node) => <CellDLInterface>celldlDiagram.getConnector(node))
            .filter((node) => node != null)
    }

    toString(): string {
        const text = super.toString()
        if (this.#interfacePorts.length) {
            return `${text}  Ports: ${this.#interfacePorts.map((c) => c.id).join(', ')}`
        }
        return text
    }

    get interfacePorts() {
        return this.#interfacePorts
    }

    get hasEditGuides() {
        return true
    }

    move(svgPoint: PointLike, options: ElementMoveOptions={}) {
        super.move(svgPoint, options)
        // A move of the compartment moves the end of outgoing connections.
        for (const port of this.#interfacePorts) {
            port.move(svgPoint, options)
        }
    }

    endMove() {
        super.endMove()
        for (const port of this.#interfacePorts) {
            port.endMove()
        }
    }

}

//==============================================================================

export class CellDLConduit extends CellDLComponent {
    static readonly celldlStyleClass = CELLDL_STYLE_CLASS.Conduit
    static celldlTypeName = 'Conduit'
}

//==============================================================================

export class CellDLCompartment extends CellDLConnectedObject {
    static readonly celldlStyleClass = CELLDL_STYLE_CLASS.Compartment
    static celldlTypeName = 'Compartment'


    constructor(
        uri: NamedNode,
        objectTemplate: ObjectTemplate,
        celldlDiagram: CellDLDiagram,
        updateStore: boolean=true
    ) {
        super(uri, objectTemplate, celldlDiagram, updateStore)
    }
    #associatedComponents: CellDLMoveableObject[] = []
    #compartmentElement: CompartmentElement|undefined

    get isAlignable() {
        return false
    }

    assignSvgElement(svgElement: SVGGraphicsElement, align: boolean) {
        this.#compartmentElement = new CompartmentElement(this, svgElement, this.isAlignable, align)
        if (this.celldlSvgElement) {
            for (const object of this.celldlDiagram.objectsContainedIn(this.celldlSvgElement.bounds)) {
                const celldlObject = object.object
                if (celldlObject.isMoveable) {
                    this.#associatedComponents.push(celldlObject as CellDLMoveableObject)
                }
            }
        }
    }

    startMove(svgPoint: PointLike, options: ElementMoveOptions={}) {
        super.startMove(svgPoint, options)
        for (const component of this.#associatedComponents) {
            component.startMove(svgPoint, { noAlign: true, snapGrid: false })
        }
    }

    move(svgPoint: PointLike, options: ElementMoveOptions={}) {
        super.move(svgPoint, options)
        // A move of the compartment moves associated components.
        for (const component of this.#associatedComponents) {
            component.move(svgPoint, { noAlign: true, snapGrid: false })
        }
    }

    endMove() {
        super.endMove()
        for (const component of this.#associatedComponents) {
            component.endMove()
        }
    }
}

//==============================================================================

export class CellDLConnection extends CellDLObject {
    static readonly celldlStyleClass = CELLDL_STYLE_CLASS.Connection
    static celldlTypeName = 'Connection'

    #connectedObjects: CellDLConnectedObject[] = []
    #svgConnection: SvgConnection|undefined

    constructor(
        uri: NamedNode,
        objectTemplate: ObjectTemplate,
        celldlDiagram: CellDLDiagram,
        updateStore: boolean=true
    ) {
        super(uri, objectTemplate, celldlDiagram, updateStore)
        const metadata = objectTemplate.metadataProperties
        const source = celldlDiagram.getConnector(metadata.getProperty(CELLDL.uri('hasSource')))
        const target = celldlDiagram.getConnector(metadata.getProperty(CELLDL.uri('hasTarget')))
        const intermediates: CellDLConnectedObject[] = metadata
            .getPropertyAsArray(CELLDL.uri('hasIntermediate'))
            .map((node) => celldlDiagram.getConnector(node))
            .filter((node) => node != null)
        if (source && target) {
            this.#connectedObjects = [source, ...intermediates, target]
            for (const connector of this.#connectedObjects) {
                connector.addConnection(this)
            }
        } else {
            alert.elementError(
                `Connection ${this.id} has no source and/or target...`,
                this.celldlSvgElement ? this.celldlSvgElement.svgElement : undefined
            )
        }
    }

    toString(): string {
        return `${super.toString()}  Connecting: ${this.#connectedObjects.map((c) => c.id).join(', ')}`
    }

    get connectedObjects() {
        return this.#connectedObjects
    }

    get intermediates(): CellDLConnectedObject[] {
        return this.#connectedObjects.slice(1, -1)
    }

    get isAlignable() {
        return false
    }

    get source(): CellDLConnectedObject | undefined {
        return this.#connectedObjects[0]
    }

    get target(): CellDLConnectedObject | undefined {
        return this.#connectedObjects.length > 1 ? this.#connectedObjects.at(-1) : undefined
    }

    assignSvgElement(svgElement: SVGGraphicsElement, _align: boolean) {
        this.#svgConnection = new SvgConnection(this, svgElement)
    }

    clearSelectedHandles() {
        if (this.#svgConnection) {
            this.#svgConnection.clearSelectedHandles()
        }
    }
}

//==============================================================================

export class CellDLInterface extends CellDLConnectedObject {
    static readonly celldlStyleClass = CELLDL_STYLE_CLASS.Interface
    static celldlTypeName = 'Interface'

    #externalConnections: CellDLConnection[] = []

    toString(): string {
        return `${super.toString()}  External: ${this.#externalConnections.map((c) => c.id).join(', ')}`
    }

    get externalConnections(): CellDLConnection[] {
        return this.#externalConnections
    }

    get isAlignable() {
        return false
    }

    addExternalConnection(connection: CellDLConnection) {
        this.#externalConnections.push(connection)
    }

    move(_svgPoint: PointLike, _options: ElementMoveOptions={}) {
        const component = <BoundedElement>this.celldlSvgElement
        const svgElement = <SVGGraphicsElement>this.celldlDiagram.svgDiagram.getElementById(component.id)
        const bounds = svgElement.getBoundingClientRect()
        const centre = new Point((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2)
        const centroid = Point.fromPoint(this.celldlDiagram.domToSvgCoords(centre))
        const savedCentroid = component.centroid
        component.setCentroid(centroid)
        component.unlimitDirection()
        const centroidDelta = component.centroid.subtract(savedCentroid)
        for (const connection of this.#externalConnections) {
            for (const path of (<SvgConnection>connection.celldlSvgElement).pathElements) {
                path.elementBoundingBoxMoved(component, centroidDelta)
            }
            connection.redraw()
        }
    }

    endMove() {
        for (const connection of this.#externalConnections) {
            for (const path of (<SvgConnection>connection.celldlSvgElement).pathElements) {
                path.endMove()
            }
        }
    }
}

//==============================================================================

export class CellDLUnconnectedPort extends CellDLConnectedObject {
    static readonly celldlStyleClass = CELLDL_STYLE_CLASS.UnconnectedPort
    static celldlTypeName = 'UnconnectedPort'
}

//==============================================================================
//==============================================================================

export const CELLDL_CLASS_MAP: Map<string, typeof CellDLObject> = new Map([
    ['Annotation', CellDLAnnotation],
    ['Compartment', CellDLCompartment],
    ['Component', CellDLComponent],
    ['Conduit', CellDLConduit],
    ['Connector', CellDLConnectedObject],
    ['Connection', CellDLConnection],
    ['Interface', CellDLInterface],
    ['UnconnectedPort', CellDLUnconnectedPort],
])

//==============================================================================
//==============================================================================
