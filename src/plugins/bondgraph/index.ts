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
/** biome-ignore-all lint/style/noNonNullAssertion: <keys exist in Map> */

// WIP: import { ucum } from '@atomic-ehr/ucum'

//==============================================================================

import {
    BGF,
    BGF_URI,
    MetadataPropertiesMap,
    type MetadataProperty,
    type MetadataStore,
    SPARQL_PREFIXES
} from '@celldl/metadata'

import * as $rdf from '@celldl/rdf'

//==============================================================================

import { arrowMarker } from '#root/utils/arrows'
import type {
    IUiJsonDiscreteInput,
    IUiJsonDiscreteInputPossibleValue
} from '#root/libopencor/locUIJsonApi'

import {
    type ItemDetails,
    PANEL_ID,
    type PropertyGroup,
    type ValueChange
} from '#root/utils/editor-types'
import type { ConnectionStatus, PluginInterface } from '#root/plugins'
import type {
    Styling
} from '#root/utils/styling'
import {
    getFillString
} from '#root/utils/svgUtils'

import { alert } from '#editor/editor/alerts'
import {
    CellDLComponent,
    type CellDLConnection,
    type CellDLObject
} from '#editor/celldlObjects'
import type {
    ComponentLibrary,
    ElementTypeName,
    ObjectTemplate
} from '#editor/components'
import {
    getItemProperty,
    updateItemProperty
} from '#editor/components/properties'

//==============================================================================

import './bgrdf'    // Run set up code
import { BGF_ONTOLOGY_URI, bgRdfStatements } from './bgrdf'

import {
    BONDGRAPH_COMPONENT_DEFINITIONS,
    DEFAULT_LOCATION,
    DEFAULT_SPECIES,
    definitionToLibraryTemplate,
    svgImageData
} from './definitions'
import { type BondInfo, equationLatex, equationText, type NodeInfo, type SpeciesNode, type StepEquation, stepEquation } from './equations'
import { type MathNode, mathmlLatex, type SignedTerm, whereLatex, whereText } from './lawtext'
import { ELEMENT_CLASSES, type NamingElement, variableNames } from './names'
import { latexAsSvgString } from '#root/mathjax'
import type {
    BGComponentLibrary,
    BGLibraryComponentTemplate,
    BGElementStyle
} from './utils'
import { DomainGraph } from './domainGraph'

//==============================================================================

export const PLUGIN_ID = 'bondgraph-components'

//==============================================================================
//==============================================================================

export class BGBaseComponent {
    #bgClass: string
    #junctionType: string|undefined
    #name: string|undefined
    #numPorts: number
    #symbol: string
    #style: BGElementStyle
    #type: string

    constructor(template: BGLibraryComponentTemplate, name: string, bgClass: string) {
        this.#name = name
        this.#bgClass = bgClass
        this.#numPorts = template.numPorts
        this.#style = template.style
        this.#symbol = template.symbol
        this.#type = template.type
    }

    get isBondElement() {
        return this.#bgClass === BGF.uri('BondElement').value
    }

    get isJunctionStructure() {
        return this.#bgClass === BGF.uri('JunctionStructure').value
    }

    get junctionType() {
        return this.#junctionType
    }

    get name() {
        return this.#name
    }

    get numPorts() {
        return this.#numPorts
    }

    get style() {
        return this.#style
    }

    get symbol() {
        return this.#symbol
    }

    get type() {
        return this.#type
    }

    setJunctionType(junctionType: string) {
        this.#junctionType = junctionType
    }
}

//==============================================================================

interface Variable {
    name: string
    units: string
    value?: string
}

type IdVariableMap = Map<string, Variable>

//==============================================================================

interface PhysicalDomain {
    id: string
    flow: Variable
    potential: Variable
    quantity: Variable
}

//==============================================================================

type ElementTemplate = ElementTypeName & {
    domain: string
    units?: string
    value?: Variable
    parameters: IdVariableMap
    variables: IdVariableMap
    symbol: string
    defaultStyle: BGElementStyle
    baseComponent: BGBaseComponent
}

//==============================================================================

interface PluginData {
    baseComponent: BGBaseComponent
    elementTemplate?: ElementTemplate
    fillString?: string
    junctionType?: string
    location?: string
    managed?: boolean
    species?: string
    symbol?: string
}

//==============================================================================

/** What a bond graph component is, as `describeElement()` gives it */
export interface BGElementDescription {
    /** The base component's type */
    kind: string
    kindName: string
    junctionType?: string
    isBondElement: boolean
    /** The element template's type, if one is chosen */
    template?: string
    templateName?: string
    symbol: string
    /** The units of the template's value, if it has one */
    valueUnits?: string
}

//==============================================================================

export enum BG_PROPERTY_GROUP_ID {
    ElementProperties = 'bg-element-properties',
    ElementInitialValue = 'bg-element-initial-value',
    ElementParameters = 'bg-element-parameters',
    ElementVariables = 'bg-element-variables'
}

const BG_PROPERTY_GROUP_IDS = Object.entries(BG_PROPERTY_GROUP_ID).map(([_, value]) => value as string)

export const BG_ELEMENT_TYPE_ITEM = `${BG_PROPERTY_GROUP_ID.ElementProperties}/bg-element-type`
export const BG_ELEMENT_SPECIES_ITEM = `${BG_PROPERTY_GROUP_ID.ElementProperties}/bg-element-species`
export const BG_ELEMENT_LOCATION_ITEM = `${BG_PROPERTY_GROUP_ID.ElementProperties}/bg-element-location`

export const BG_ELEMENT_VALUE_ITEM = `${BG_PROPERTY_GROUP_ID.ElementInitialValue}/bg-element-value`

//==============================================================================

type IndexedPropertyGroup = PropertyGroup & {
    index: number
}

// The following is a function because its code requires the RDF package to
// have been initialised.

function elementPropertiesTemplate(): IndexedPropertyGroup[] {
    return [{
        groupId: BG_PROPERTY_GROUP_ID.ElementProperties,
        title: 'Element',
        index: 0,
        items: [
            {
                itemId: BG_ELEMENT_TYPE_ITEM,
                property: $rdf.RDF.uri('type').value,
                name: 'Bond Element',
                possibleValues: [],
                optional: true
            },
            {
                itemId: BG_ELEMENT_SPECIES_ITEM,
                property: BGF.uri('hasSpecies').value,
                name: 'Species',
                defaultValue: ''
            },
            {
                itemId: BG_ELEMENT_LOCATION_ITEM,
                property: BGF.uri('hasLocation').value,
                name: 'Location',
                defaultValue: ''
            }
        ]
    }, {
        groupId: BG_PROPERTY_GROUP_ID.ElementInitialValue,
        title: 'Initial value',
        index: 1,
        items: [
            {
                itemId: BG_ELEMENT_VALUE_ITEM,
                property: BGF.uri('hasValue').value,
                name: 'Initial value',
                defaultValue: 0,
                numeric: true,
                optional: true
            }
        ]
    }, {
        groupId: BG_PROPERTY_GROUP_ID.ElementParameters,
        title: 'Parameters',
        index: 2,
        items: []
    }, {
        groupId: BG_PROPERTY_GROUP_ID.ElementVariables,
        title: 'Variables',
        index: 3,
        items: []
    }]
}

// Within ELEMENT_PROPERTIES_GROUP
const ELEMENT_TYPE_INDEX = 0

//==============================================================================

const BG_STYLE_GROUP_ID = 'bg-element-style'

const BG_STYLING_TEMPLATE: PropertyGroup = {
    groupId: BG_STYLE_GROUP_ID,
    items: [],
    styling: {}
}

//==============================================================================

const DEFAULT_TRANSFORM_RATIO = 1

/** The value a parameter gets when its element's template is chosen */
const DEFAULT_PARAMETER_VALUE = 1

const TRANSFORM_NODE_PROMPT = 'Ratio'

//==============================================================================
//==============================================================================

export class BondgraphPlugin implements PluginInterface {
    readonly id: string = PLUGIN_ID

    #baseComponents: Map<string, BGBaseComponent> = new Map()                       // Indexed by component.type
    #baseComponentToElementTemplates: Map<string, ElementTemplate[]> = new Map()    // Indexed by component.type
    #domainGraph: DomainGraph = new DomainGraph(undefined)
    #elementTemplates: Map<string, ElementTemplate> = new Map()                     // Indexed by element.type
    #elementPropertiesTemplate: Map<string, IndexedPropertyGroup> = new Map()
    #componentLibrary: BGComponentLibrary = {
        id: this.id,
        name: 'Bondgraph',
        templates: []
    }
    #componentTemplates: Map<string, BGLibraryComponentTemplate> = new Map()
    #currentDocumentUri: string = ''
    #documentStore: MetadataStore|undefined
    #physicalDomains: Map<string, PhysicalDomain> = new Map()
    #rdfStore: $rdf.RdfStore = new $rdf.RdfStore()
    #transformNodeType = BGF.uri('TransformNode').value

    constructor() {
        for (const group of elementPropertiesTemplate()) {
            this.#elementPropertiesTemplate.set(group.groupId, group)
        }
        this.#rdfStore.addStatements(bgRdfStatements())
        this.#initialiseComponentLibrary()
        this.#loadDomains()
        this.#loadBaseComponents()
        this.#assignTemplates()
        this.#loadTemplateParameters()
    }

    //==========================================================================

    get componentLibrary(): ComponentLibrary {
        return this.#componentLibrary
    }

    #getName(type: string): string {
        if (this.#elementTemplates.has(type)) {
            return this.#elementTemplates.get(type)!.name
        }
        if (this.#baseComponents.has(type)) {
            return this.#baseComponents.get(type)!.name || ''
        }
        return ''
    }

    getPanelTemplates(panelId: PANEL_ID): PropertyGroup[] {
        if (panelId === PANEL_ID.PROPERTIES_PANEL) {
            return [...this.#elementPropertiesTemplate.values()]
        } else if (panelId === PANEL_ID.STYLE_PANEL) {
            return [BG_STYLING_TEMPLATE]
        }
        return []
    }

    getTemplateName(rdfType: string): string|undefined {
        const elementTemplate = this.#elementTemplates.get(rdfType)
        if (elementTemplate) {
            return elementTemplate.name
        }
        const baseComponent = this.#baseComponents.get(rdfType)
        if (baseComponent) {
            return baseComponent.name
        }
    }

    getObjectTemplateById(id: string): ObjectTemplate|undefined {
        const componentTemplate = this.#componentTemplates.get(id)
        if (componentTemplate) {
            const metadataProperties: MetadataProperty[] = [
                [ $rdf.RDF.uri('type'), $rdf.namedNode(componentTemplate.type)],
                [ BGF.uri('hasSymbol'), $rdf.literal(componentTemplate.symbol)]
            ]
            if (!componentTemplate.noSpeciesLocation) {
                metadataProperties.push(
                    [ BGF.uri('hasSpecies'), $rdf.literal(DEFAULT_SPECIES) ],
                    [ BGF.uri('hasLocation'), $rdf.literal(DEFAULT_LOCATION) ]
                )
            }
            if (componentTemplate.type === this.#transformNodeType) {
                metadataProperties.push(
                    // Passing a number causes a memory exception in oxigraph...
                    [ BGF.uri('hasValue'), $rdf.literal(String(DEFAULT_TRANSFORM_RATIO)) ],
                )
            }
            return {
                CellDLClass: CellDLComponent,
                imageData: componentTemplate.imageData,
                metadataProperties: MetadataPropertiesMap.fromProperties(metadataProperties),
                name: this.#getName(componentTemplate.type)
            }
        }
    }

    //==========================================================================

    openDiagram(uri: string, rdfStore: MetadataStore) {
        // We are creating a BondgraphModel
        rdfStore.add($rdf.namedNode(uri), $rdf.RDF.uri('type'), BGF.uri('BondgraphModel'))

        this.#currentDocumentUri = uri
        this.#documentStore = rdfStore

        // Add a copy of the BG-RDF framework as a **named graph**, to use when
        // finding BondElements and JunctionStructures
        const bgfGraph = $rdf.namedNode(BGF_ONTOLOGY_URI)
        for (const statement of this.#rdfStore.statements()) {
            rdfStore.add(statement.subject, statement.predicate, statement.object, bgfGraph)
        }
        this.#domainGraph = new DomainGraph(rdfStore, uri)
    }

    //======================================

    addPluginMetadataToStore(rdfStore: MetadataStore) {
        // First remove existing statements about components in the document

        rdfStore.update(`${SPARQL_PREFIXES}
            DELETE {
                <${this.#currentDocumentUri}> bgf:hasBondElement ?uri
            }
            WHERE {
                <${this.#currentDocumentUri}> bgf:hasBondElement ?uri
            }`)
        rdfStore.update(`${SPARQL_PREFIXES}
            DELETE {
                <${this.#currentDocumentUri}> bgf:hasJunctionStructure ?uri
            }
            WHERE {
                <${this.#currentDocumentUri}> bgf:hasJunctionStructure ?uri
            }`)

        const statements: string[] = []

        // Find the BondElements in the diagram

        rdfStore.query(`${SPARQL_PREFIXES}
            PREFIX : <${this.#currentDocumentUri}#>
            SELECT ?uri
            WHERE {
                ?uri a ?type .
                ?type rdfs:subClassOf* bgf:BondElement
            }`, true)
        .forEach((r: Map<string, $rdf.Term>) => {
            statements.push(`<${this.#currentDocumentUri}> bgf:hasBondElement ${r.get('uri')!.toString()} .`)
        })

        // Find the JunctionStructures in the diagram. Composite elements (e.g. a
        // bgf:ZeroStorageNode) are both, but are listed only as BondElements, as
        // in BG-RDF's own examples

        rdfStore.query(`${SPARQL_PREFIXES}
            PREFIX : <${this.#currentDocumentUri}#>

            SELECT ?uri
            WHERE {
                ?uri a ?type .
                ?type rdfs:subClassOf* bgf:JunctionStructure
                FILTER NOT EXISTS {
                    ?type rdfs:subClassOf* ?composite .
                    ?composite a bgf:CompositeElement
                }
            }`, true)
        .forEach((r: Map<string, $rdf.Term>) => {
            statements.push(`<${this.#currentDocumentUri}> bgf:hasJunctionStructure ${r.get('uri')!.toString()} .`)
        })

        // And add them to the BondgraphModel

        rdfStore.update(`${SPARQL_PREFIXES}
            INSERT DATA {
                ${statements.join('\n')}
            }
        `)
    }

    //==========================================================================
    //==========================================================================

    getPluginData(celldlObject: CellDLObject): object {
        if (celldlObject.isConnection) {
            return {
                baseComponent: {},
                managed: true
            }
        }
        const rows = celldlObject.rdfStore.query(`${SPARQL_PREFIXES}
            PREFIX : <${this.#currentDocumentUri}#>
            SELECT ?type ?symbol WHERE {
                ${celldlObject.uri.toString()} a ?type
                OPTIONAL { ${celldlObject.uri.toString()} bgf:hasSymbol ?symbol }
            }`
        )
        let pluginData: PluginData|undefined
        for (const r of rows) {
            const rdfType = r.get('type')!.value
            if (rdfType.startsWith(BGF_URI)) {
                const symbol = r.get('symbol')
                const baseComponent = this.#baseComponents.get(rdfType)
                if (baseComponent && !pluginData) {
                    pluginData = { baseComponent } as PluginData
                    if (baseComponent.junctionType) {
                        pluginData.junctionType = baseComponent.junctionType
                    }
                }
                if (this.#elementTemplates.has(rdfType)) {
                    const elementTemplate = this.#elementTemplates.get(rdfType)!
                    if (pluginData) {
                        pluginData.elementTemplate = elementTemplate
                    } else {
                        pluginData = {
                            baseComponent: elementTemplate.baseComponent,
                            elementTemplate: elementTemplate
                        }
                    }
                }
                if (symbol && pluginData) {
                    pluginData.symbol = symbol.value
                }
            }
        }
        if (pluginData) {
            pluginData.managed = true
            return pluginData

        }
        return {}
    }

    //==========================================================================

    #subclassesOf(base: string): Set<string> {
        const rows = this.#rdfStore.query(`${SPARQL_PREFIXES}
            SELECT DISTINCT ?type WHERE { ?type rdfs:subClassOf* <${base}> }`)
        return new Set([base, ...rows.map((r: Map<string, $rdf.Term>) => r.get('type')!.value)])
    }

    // The diagram's bonds and nodes, as ./equations.ts uses them
    #diagramGraph() {
        const bonds: BondInfo[] = []
        const nodes: Map<string, NodeInfo> = new Map()
        const steps: [string, boolean][] = []
        const species: SpeciesNode[] = []
        const store = this.#documentStore
        if (!store) return { bonds, nodes, steps, species }
        const prefix = `${this.#currentDocumentUri}#`
        const reactions = this.#subclassesOf(BGF.uri('Reaction').value)
        const resistances = this.#subclassesOf(BGF.uri('Resistance').value)
        const transforms = this.#subclassesOf(this.#transformNodeType)
        const stores = this.#subclassesOf(BGF.uri('QuantityStore').value)
        const sources = this.#subclassesOf(BGF.uri('PotentialSource').value)
        for (const r of store.query(`${SPARQL_PREFIXES}
            SELECT ?bond ?source ?target ?count WHERE {
                ?bond bgf:hasSource ?source ; bgf:hasTarget ?target .
                OPTIONAL { ?bond bgf:bondCount ?count }
            }`) as Map<string, $rdf.Term>[]) {
            if (!r.get('bond')!.value.startsWith(prefix)) continue
            bonds.push({
                id: r.get('bond')!.value,
                source: r.get('source')!.value,
                target: r.get('target')!.value,
                count: r.get('count') ? Number(r.get('count')!.value) : 1
            })
        }
        for (const r of store.query(`${SPARQL_PREFIXES}
            SELECT ?node ?type ?species ?location ?symbol ?value WHERE {
                ?node a ?type .
                OPTIONAL { ?node bgf:hasSpecies ?species }
                OPTIONAL { ?node bgf:hasLocation ?location }
                OPTIONAL { ?node bgf:hasSymbol ?symbol }
                OPTIONAL { ?node bgf:hasValue ?value }
            }`) as Map<string, $rdf.Term>[]) {
            const node = r.get('node')!.value
            if (!node.startsWith(prefix)) continue
            const type = r.get('type')!.value
            const info: NodeInfo = nodes.get(node) ?? {
                species: r.get('species')?.value, location: r.get('location')?.value, symbol: r.get('symbol')?.value
            }
            if (transforms.has(type) && r.get('value')) {
                info.transformRatio = parseFloat(r.get('value')!.value)
            }
            nodes.set(node, info)
            if ((reactions.has(type) || resistances.has(type)) && !steps.some(([n]) => n === node)) {
                steps.push([node, resistances.has(type)])
            }
            if ((stores.has(type) || sources.has(type)) && info.species && !species.some(n => n.id === node)) {
                species.push({ id: node, species: info.species, location: info.location, isSource: sources.has(type) })
            }
        }
        return { bonds, nodes, steps, species }
    }

    /**
     * The diagram's reactions, transport steps and flows as equations in their usual form, from its bonds (see
     * ./equations.ts), in the order of the diagram's elements.
     */
    reactionEquations(): StepEquation[] {
        const { bonds, nodes, steps } = this.#diagramGraph()
        return steps.map(([node, isResistance]) => stepEquation(node, isResistance, bonds, nodes))
    }

    /** The diagram's species stores and sources. */
    speciesNodes(): SpeciesNode[] {
        return this.#diagramGraph().species
    }

    /**
     * The diagram's bond elements with the variables bg2cellml gives them (./names.ts): its flow and potential
     * (a reaction's u_f and u_r), its template's parameters and variables, then its own quantity.
     */
    namingElements(): NamingElement[] {
        const store = this.#documentStore
        if (!store) return []
        const prefix = `${this.#currentDocumentUri}#`
        const classes = ELEMENT_CLASSES.map(uri => ({ uri, types: this.#subclassesOf(uri) }))
        const elements = new Map<string, NamingElement>()
        for (const r of store.query(`${SPARQL_PREFIXES}
            SELECT ?node ?type ?symbol ?species ?location WHERE {
                ?node a ?type .
                OPTIONAL { ?node bgf:hasSymbol ?symbol }
                OPTIONAL { ?node bgf:hasSpecies ?species }
                OPTIONAL { ?node bgf:hasLocation ?location }
            }`) as Map<string, $rdf.Term>[]) {
            const node = r.get('node')!.value
            const template = this.#elementTemplates.get(r.get('type')!.value)
            if (!node.startsWith(prefix) || !template || elements.has(node)) continue
            const elementClass = classes.find(c => c.types.has(template.type))?.uri
            const domain = this.#physicalDomains.get(template.domain)
            const flow = domain?.flow.name ?? 'v', potential = domain?.potential.name ?? 'u'
            const ports = elementClass === BGF.uri('Reaction').value ? [flow, `${potential}_f`, `${potential}_r`]
                        : [flow, potential]
            // a store's quantity takes the element's own name (a source's potential doesn't)
            const value = template.value?.name
            const intrinsic = value !== undefined && value === (domain?.quantity.name ?? 'q') ? value : undefined
            const variables = [...ports, ...template.parameters.keys(), ...template.variables.keys()]
                              .filter(v => v !== intrinsic)
            if (intrinsic) variables.push(intrinsic)
            elements.set(node, {
                id: node, identifier: node.slice(prefix.length), elementClass, domain: template.domain,
                label: r.get('symbol')?.value, species: r.get('species')?.value, location: r.get('location')?.value,
                variables: [...new Set(variables)], intrinsic
            })
        }
        return [...elements.values()]
    }

    /** The element type of a component (its template's, else its base component's). */
    elementType(celldlObject: CellDLObject): string|undefined {
        const pluginData = <PluginData>celldlObject.pluginData(this.id)
        return pluginData.elementTemplate?.type ?? pluginData.baseComponent?.type
    }

    /** The id of the component library template to draw a new element of `elementType` from. */
    libraryTemplateId(elementType: string): string|undefined {
        const baseType = this.#elementTemplates.get(elementType)?.baseComponent.type ?? elementType
        for (const [id, template] of this.#componentTemplates) {
            if (template.type === baseType) return `${this.id}/${id}`
        }
    }

    /**
     * Give a component just added from a library template its element type, species and location, as the
     * properties panel does, and optionally an initial value (an RDF literal, copied as it is).
     */
    async setElement(celldlObject: CellDLObject, elementType: string, species?: string, location?: string,
                     value?: $rdf.Literal) {
        const pluginData = <PluginData>celldlObject.pluginData(this.id)
        const current = this.elementType(celldlObject)
        if (current !== elementType) {
            await this.#updateElementType(<ItemDetails>{}, { oldValue: current ?? '', newValue: elementType },
                                          celldlObject)
        }
        if (species !== undefined) {
            updateItemProperty(BGF.uri('hasSpecies').value, { oldValue: pluginData.species ?? '', newValue: species },
                               celldlObject)
            pluginData.species = species
        }
        if (location !== undefined) {
            updateItemProperty(BGF.uri('hasLocation').value,
                               { oldValue: pluginData.location ?? '', newValue: location }, celldlObject)
            pluginData.location = location
        }
        if (value) {
            const objectUri = celldlObject.uri.toString()
            celldlObject.rdfStore.update(`${SPARQL_PREFIXES}
                PREFIX : <${this.#currentDocumentUri}#>
                DELETE WHERE { ${objectUri} bgf:hasValue ?value }`)
            celldlObject.rdfStore.update(`${SPARQL_PREFIXES}
                PREFIX : <${this.#currentDocumentUri}#>
                INSERT DATA { ${objectUri} bgf:hasValue ${value.toString()} }`)
        }
        await this.#updateSvgElement(celldlObject, pluginData.species, pluginData.location)
    }

    /** Set a bond's bgf:bondCount (1 is left implicit). */
    setBondCount(connection: CellDLConnection, count: number) {
        const uri = connection.uri.toString()
        connection.rdfStore.update(`${SPARQL_PREFIXES}
            PREFIX : <${this.#currentDocumentUri}#>
            DELETE WHERE { ${uri} bgf:bondCount ?count }`)
        if (count !== 1) {
            connection.rdfStore.update(`${SPARQL_PREFIXES}
                PREFIX : <${this.#currentDocumentUri}#>
                INSERT DATA { ${uri} bgf:bondCount ${Math.round(count)} }`)
        }
    }

    #lawCache = new Map<string, { label: string, latex: string, svg: string }|null>()

    // a template's constitutive relation (its own or the nearest superclass's) as LaTeX and typeset SVG, and its label
    #law(templateType: string): { label: string, latex: string, svg: string }|null {
        if (this.#lawCache.has(templateType)) return this.#lawCache.get(templateType)!
        let found: { label: string, latex: string, svg: string }|null = null
        const queue = [templateType], seen = new Set<string>()
        let label = ''
        while (queue.length && !found) {
            const type = queue.shift()!
            if (seen.has(type)) continue
            seen.add(type)
            for (const r of this.#rdfStore.query(`${SPARQL_PREFIXES}
                SELECT ?relation ?label WHERE {
                    OPTIONAL { <${type}> bgf:constitutiveRelation ?relation }
                    OPTIONAL { <${type}> rdfs:label ?label }
                }`) as Map<string, $rdf.Term>[]) {
                if (!label && r.get('label')) label = r.get('label')!.value
                const relation = r.get('relation')?.value
                if (relation && !found) {
                    const math = new DOMParser().parseFromString(relation.trim(), 'text/xml').documentElement
                    const latex = mathmlLatex(math as unknown as MathNode)
                    found = { label, latex, svg: latex ? latexAsSvgString(latex, true) : '' }
                }
            }
            for (const r of this.#rdfStore.query(`${SPARQL_PREFIXES}
                SELECT ?super WHERE { <${type}> rdfs:subClassOf ?super }`) as Map<string, $rdf.Term>[]) {
                queue.push(r.get('super')!.value)
            }
        }
        if (found && !found.label) found.label = label
        this.#lawCache.set(templateType, found)
        return found
    }

    /**
     * What an element's hover shows (./lawtext.ts): its constitutive law, typeset in its template's symbols, and
     * each symbol's CellML name (./names.ts) with what the bonds make it: a reaction's u_f and u_r (the potentials
     * bonded to each side, a transformer's scaled by its ratio), a store's flow (its reactions' flows), a
     * resistance's potential (the difference across it). '' for an element without a law.
     */
    hoverHtml(celldlObject: CellDLObject): string {
        if (celldlObject.isConnection) return ''
        const templateType = (<PluginData>celldlObject.pluginData(this.id)).elementTemplate?.type
        const law = templateType ? this.#law(templateType) : null
        if (!law) return ''
        const id = celldlObject.uri.value
        const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        // an equation typeset as the law is, its text kept in data-text; the text itself if MathJax rejects it
        const typeset = (latex: string, text: string) => {
            let svg: string
            try { svg = latexAsSvgString(latex) } catch { svg = escape(text) }
            return `<div class="bg-law-line" data-text="${escape(text)}">${svg}</div>`
        }
        const elements = this.namingElements()
        const element = elements.find(e => e.id === id)
        if (!element) return ''
        const names = variableNames(elements)
        const { bonds, nodes } = this.#diagramGraph()
        const byId = new Map(elements.map(e => [e.id, e]))
        const portName = (node: string, port: 'flow'|'potential') => {
            const e = byId.get(node)
            const domain = e?.domain ? this.#physicalDomains.get(e.domain) : undefined
            const symbol = port === 'flow' ? (domain?.flow.name ?? 'v') : (domain?.potential.name ?? 'u')
            return names.get(`${node}|${symbol}`) ?? symbol
        }
        const domain = element.domain ? this.#physicalDomains.get(element.domain) : undefined
        const u = domain?.potential.name ?? 'u', v = domain?.flow.name ?? 'v'
        const connected = new Map<string, SignedTerm[]>()
        if (element.elementClass === BGF.uri('Reaction').value) {
            const side = (into: boolean) => bonds.flatMap((b): SignedTerm[] => {
                const other = into ? (b.target === id ? b.source : undefined) : (b.source === id ? b.target : undefined)
                if (other === undefined) return []
                const ratio = nodes.get(other)?.transformRatio
                if (ratio !== undefined) {      // a transformer between this step and a capacitor
                    const capacitor = into ? bonds.find(c => c.target === other)?.source : bonds.find(c => c.source === other)?.target
                    return capacitor ? [{ sign: 1, count: into ? ratio : 1 / ratio, name: portName(capacitor, 'potential') }] : []
                }
                return [{ sign: 1, count: b.count, name: portName(other, 'potential') }]
            })
            connected.set(`${u}_f`, side(true))
            connected.set(`${u}_r`, side(false))
        } else if (element.elementClass === BGF.uri('QuantityStore').value) {
            connected.set(v, bonds.flatMap((b): SignedTerm[] => b.target === id ? [{ sign: 1, count: b.count, name: portName(b.source, 'flow') }]
                                                      : b.source === id ? [{ sign: -1, count: b.count, name: portName(b.target, 'flow') }]
                                                      : []))
        } else if (element.elementClass === BGF.uri('Resistance').value) {
            connected.set(u, bonds.flatMap((b): SignedTerm[] => b.target === id ? [{ sign: 1, count: 1, name: portName(b.source, 'potential') }]
                                                      : b.source === id ? [{ sign: -1, count: 1, name: portName(b.target, 'potential') }]
                                                      : []))
        }
        const where = element.variables.map(symbol => ({
            symbol, name: names.get(`${id}|${symbol}`) ?? symbol, is: connected.get(symbol)
        }))
        const whereLatexLines = whereLatex(where)
        const step = this.reactionEquations().find(eq => eq.id === id)
        return '<div class="bg-law">'
            + (step ? `<div class="bg-law-equation">${typeset(equationLatex(step), equationText(step))}</div>` : '')
            + (law.label ? `<div class="bg-law-label">${escape(law.label)}</div>` : '')
            + (law.svg ? `<div class="bg-law-math">${law.svg}</div>` : '')
            + `<div class="bg-law-where">${whereText(where).map((text, k) => typeset(whereLatexLines[k]!, text)).join('')}</div>`
            + '</div>'
    }

    hoverText(celldlObject: CellDLObject): string {
        if (celldlObject.isConnection) return ''
        const step = this.reactionEquations().find(eq => eq.id === celldlObject.uri.value)
        return step ? equationText(step) : ''
    }

    statusText(celldlObject: CellDLObject): string {
        const pluginData = <PluginData>celldlObject.pluginData(this.id)
        let domain: string|undefined
        if (pluginData.baseComponent?.isBondElement) {
            domain = pluginData.elementTemplate?.domain
        } else {
            domain = this.#domainGraph.getDomain(celldlObject.uri.value)
        }
        return domain ? $rdf.getFragment(domain) : ''
    }

    //==========================================================================
    //==========================================================================

    addComponent(component: CellDLObject) {
        const pluginData = <PluginData>component.pluginData(this.id)
        this.#domainGraph.addNode(component.uri.value,
            pluginData.elementTemplate?.domain,
            pluginData.baseComponent.type === this.#transformNodeType)
    }

    componentDeleted(component: CellDLObject) {
        this.#domainGraph.deleteNode(component.uri.value)
    }

    //==========================================================================
    //==========================================================================

    addConnection(connection: CellDLConnection) {
        this.#domainGraph.addEdge(connection.uri.value, [connection.source!.uri.value, connection.target!.uri.value])
        const uri = connection.uri.toString()
        connection.rdfStore.update(`${SPARQL_PREFIXES}
            PREFIX : <${this.#currentDocumentUri}#>
            INSERT DATA {
                ${uri} bgf:hasSource ${connection.source!.uri.toString()} .
                ${uri} bgf:hasTarget ${connection.target!.uri.toString()} .
            }
        `)
    }

    checkConnectionValid(sourceObject: CellDLObject, targetObject: CellDLObject): ConnectionStatus|undefined {
        /*
        Junctions and elements:
            JT ==> `Composite with Junction` or `Junction`
                    JT value is `One`, `Transform`, or `Zero`
         No JT ==> `Element`

        Can't have direct:
            Element <---> Element
            One <---> One
            Zero <---> Zero
            Transform <---> Transform

            Element <---> Transform ??

            Element <---> Transform <---> Element
            One <---> Transform <---> One
            Zero <---> Transform <---> Zero

        Domains:
            Allow:
                undefined <---> Any
                Same <---> Same
        */
        if (this.#domainGraph.hasEdge([sourceObject.uri.value, targetObject.uri.value])
         || this.#domainGraph.hasEdge([targetObject.uri.value, sourceObject.uri.value])
        ) {
            return { alert: 'Components are already connected' }
        }
        const sourceData = <PluginData>sourceObject.pluginData(this.id)
        const targetData = <PluginData>targetObject.pluginData(this.id)
        if (!sourceData.managed || !targetData.managed) {
            return
        }
        if (sourceData.junctionType === targetData.junctionType) {
            if (!sourceData.junctionType) {
                return { alert: 'Direct connections between Bond Elements are not allowed' }
            } else {
                return { alert: `Cannot directly connect two ${$rdf.getFragment(sourceData.junctionType)} nodes` }
            }
        }
        const sourceDomain = this.#domainGraph.getDomain(sourceObject.uri.value)
        const targetDomain = this.#domainGraph.getDomain(targetObject.uri.value)
        if (sourceDomain && targetDomain && sourceDomain !== targetDomain) {
            return { alert: `Cannot connect ${$rdf.getFragment(sourceDomain)} and ${$rdf.getFragment(targetDomain)} physical domains` }
        }
    }

    connectionDeleted(connection: CellDLConnection) {
        this.#domainGraph.deleteEdge([connection.source!.uri.value, connection.target!.uri.value])
        const uri = connection.uri.toString()
        connection.rdfStore.update(`${SPARQL_PREFIXES}
            PREFIX : <${this.#currentDocumentUri}#>
            DELETE DATA {
                ${uri} bgf:hasSource ${connection.source!.uri.toString()} .
                ${uri} bgf:hasTarget ${connection.target!.uri.toString()} .
            }
        `)
    }

    getMaxConnections(celldlObject: CellDLObject): number {
        const pluginData = (<PluginData>celldlObject.pluginData(this.id))
        return pluginData.baseComponent?.numPorts || Infinity
    }

    //==========================================================================

    loadComponentProperties(componentProperties: PropertyGroup[], panelId: PANEL_ID, celldlObject: CellDLObject) {
        alert.clear()
        if (panelId === PANEL_ID.PROPERTIES_PANEL) {
            if (!celldlObject.isConnection) {
                const pluginData = (<PluginData>celldlObject.pluginData(this.id))
                componentProperties.forEach(group => {
                   if (BG_PROPERTY_GROUP_IDS.includes(group.groupId)) {
                        const groupTemplate = this.#elementPropertiesTemplate.get(group.groupId)
                        if (groupTemplate) {
                            if (group.groupId === BG_PROPERTY_GROUP_ID.ElementProperties) {
                                this.#loadElementProperties(celldlObject, group, groupTemplate)
                            } else if (group.groupId === BG_PROPERTY_GROUP_ID.ElementInitialValue) {
                                this.#loadElementProperties(celldlObject, group, groupTemplate)
                            } else if (pluginData.elementTemplate) {
                                if (group.groupId === BG_PROPERTY_GROUP_ID.ElementParameters) {
                                    this.#setVariableItems(pluginData.elementTemplate.parameters, group)
                                    this.#loadVariableItems(celldlObject, group)
                                } else if (group.groupId === BG_PROPERTY_GROUP_ID.ElementVariables) {
                                    this.#setVariableItems(pluginData.elementTemplate.variables, group)
                                    this.#loadVariableItems(celldlObject, group)
                                }
                            }
                        }
                    }
                })
            }
        } else if (panelId === PANEL_ID.STYLE_PANEL) {
            componentProperties.forEach(group => {
                if (group.groupId === BG_STYLE_GROUP_ID) {
                    this.#loadElementStyling(celldlObject, group, celldlObject.isConnection)
                }
            })
        }
    }

    #loadElementProperties(celldlObject: CellDLObject, componentGroup: PropertyGroup, groupTemplate: IndexedPropertyGroup) {
        const pluginData = <PluginData>celldlObject.pluginData(this.id)
        groupTemplate.items.forEach((itemDetails: ItemDetails) => {
            const items: ItemDetails[] = []
            if (itemDetails.itemId === BG_ELEMENT_TYPE_ITEM) {
                const discreteItem = this.#getElementTypeItem(celldlObject, itemDetails, pluginData)
                items.push(discreteItem)
            } else if (itemDetails.itemId === BG_ELEMENT_SPECIES_ITEM ||
                       itemDetails.itemId === BG_ELEMENT_LOCATION_ITEM) {
                const item = getItemProperty(celldlObject, itemDetails)
                if (item) {
                    if (itemDetails.itemId === BG_ELEMENT_SPECIES_ITEM) {
                        pluginData.species = String(item.value)
                    } else {
                        pluginData.location = String(item.value)
                    }
                    items.push(item)
                }
            } else if (itemDetails.itemId === BG_ELEMENT_VALUE_ITEM) {
                const item = getItemProperty(celldlObject, itemDetails)
                if (item) {
                    items.push(item)
                    item.optional = false
                    if (pluginData.baseComponent.type === this.#transformNodeType) {
                        item.name = TRANSFORM_NODE_PROMPT
                    }
                }
            }
            componentGroup.items.push(...items)
        })
    }

    #loadElementStyling(celldlObject: CellDLObject, componentGroup: PropertyGroup, connection: boolean) {
        if (connection) {
            componentGroup.styling = celldlObject.celldlSvgElement!.getStyle()
        } else {
            const pluginData = (<PluginData>celldlObject.pluginData(this.id))
            if (!('fillString' in pluginData)) {
                pluginData.fillString = celldlObject.celldlSvgElement!.getStyle().fillStyle // getFillString(celldlObject.celldlSvgElement!.svgElement)
            }
            componentGroup.styling = {
                fillStyle: pluginData.fillString
            }
        }
    }

    #deleteVariableItems(celldlObject: CellDLObject, group: PropertyGroup) {
        const predicate = (group.groupId === BG_PROPERTY_GROUP_ID.ElementParameters)
                        ? 'bgf:parameterValue'
                        : 'bgf:VariableValue'
        const objectUri = celldlObject.uri.toString()
        celldlObject.rdfStore.update(`${SPARQL_PREFIXES}
            PREFIX : <${this.#currentDocumentUri}#>

            DELETE WHERE {
                ${objectUri} ${predicate} ?pv .
                ?pv ?p ?o .
            }`)
    }

    #loadVariableItems(celldlObject: CellDLObject, group: PropertyGroup) {
        const predicate = (group.groupId === BG_PROPERTY_GROUP_ID.ElementParameters)
                        ? 'bgf:parameterValue'
                        : 'bgf:VariableValue'
        const objectUri = celldlObject.uri.toString()

        const values: Map<string, string> = new Map()
        celldlObject.rdfStore.query(`${SPARQL_PREFIXES}
            PREFIX : <${this.#currentDocumentUri}#>

            SELECT ?name ?value
            WHERE {
                ${objectUri} ${predicate} [
                    bgf:varName ?name ;
                    bgf:hasValue ?value
                ]
            }`
        ).forEach((r) => {
            values.set(r.get('name')!.value, r.get('value')!.value)
        })

        group.items.forEach(item => {
            const itemVariable = item.itemId.split('/')
            const varName = itemVariable[1]!
            if (values.has(varName)) {
                const valueUnits = values.get(varName)!.split(' ')
                item.value = valueUnits[0]
                item.units = valueUnits[1]
                item.stored = true
            } else {
                item.stored = false
            }
        })
    }

    /** Stores `DEFAULT_PARAMETER_VALUE` for each parameter shown with an unstored default. */
    #storeDefaultParameters(celldlObject: CellDLObject, group: PropertyGroup, elementTemplate: ElementTemplate) {
        for (const item of group.items) {
            if (item.stored === false) {
                const value = String(DEFAULT_PARAMETER_VALUE)
                this.#updateVariableProperties({ oldValue: '', newValue: value }, group.groupId,
                                               item.itemId, celldlObject, elementTemplate)
                item.value = value
                item.stored = true
            }
        }
    }

    //==========================================================================

    #deleteElementValue(celldlObject: CellDLObject) {
        const groupTemplate = this.#elementPropertiesTemplate.get(BG_PROPERTY_GROUP_ID.ElementInitialValue)
        const itemDefn = groupTemplate?.items.at(0)
        if (itemDefn) {
            updateItemProperty(itemDefn.property, { newValue: '', oldValue: ''}, celldlObject)
        }
    }

    #setElementValue(variable: Variable|undefined, group: PropertyGroup, celldlObject: CellDLObject) {
        const groupTemplate = this.#elementPropertiesTemplate.get(BG_PROPERTY_GROUP_ID.ElementInitialValue)
        const itemDefn = groupTemplate?.items.at(0)
        if (itemDefn) {
            let item = group.items[0]
            if (item) {
                if (variable) {
                    item.name = `${itemDefn.name} (${variable.units})`
                    item.optional = false
                } else {
                    item.optional = false
                    item.value = 0
                }
            } else if (variable) {
                item = Object.assign({}, itemDefn, {
                    name: `${itemDefn.name} (${variable.units})`,
                    optional: false,
                    value: itemDefn.defaultValue
                })
                group.items.push(item)
            }
            if (item) {
                const elementTemplate = (<PluginData>celldlObject.pluginData(this.id)).elementTemplate
                const newValue = String(item.value).trim()
                if (newValue && elementTemplate) {
                    const objectUri = celldlObject.uri.toString()
                    const variable = elementTemplate!.value
                    celldlObject.rdfStore.update(`${SPARQL_PREFIXES}
                        PREFIX : <${this.#currentDocumentUri}#>

                        INSERT DATA {
                           ${objectUri} bgf:hasValue "${newValue} ${variable!.units}"^^cdt:ucum .
                        }
                    `)
                }
            }
        }
    }

    #setVariableItems(variables: IdVariableMap, group: PropertyGroup, reset: boolean=false) {
        if (reset) {
            group.items.length = 0
        }
        if (group.items.length === 0) {
            const property = (group.groupId === BG_PROPERTY_GROUP_ID.ElementParameters)
                            ? BGF.uri('parameterValue').value
                            : BGF.uri('valueVariableValue').value
            for (const variable of variables.values()) {
                group.items.push({
                    itemId: `${group.groupId}/${variable.name}`,
                    property: property,
                    name: variable.name,
                    units: variable.units,
                    minimumValue: 0,
                    defaultValue: 0,
                    value: 0,
                    numeric: true
                })
            }
        }
    }

    //==========================================================================
    //==========================================================================

    // biome-ignore lint/correctness/noUnusedPrivateClassMembers: used for debugging
    #printObjectProperties(celldlObject: CellDLObject) {
        const objectUri = celldlObject.uri.toString()

        celldlObject.rdfStore.query(`${SPARQL_PREFIXES}
            PREFIX : <${this.#currentDocumentUri}#>

            SELECT ?p ?o WHERE {
                ${objectUri} ?p ?o
            }`).forEach((r: Map<string, $rdf.Term>) => {
            console.log(celldlObject.id, r.get('p')!.value, r.get('o')!.value)
        })
    }

    //==========================================================================
    //==========================================================================

    async updateObjectProperties(celldlObject: CellDLObject, panelId: PANEL_ID, itemId: string, value: ValueChange,
                                 componentProperties: PropertyGroup[]): Promise<string> {
        if (panelId === PANEL_ID.PROPERTIES_PANEL) {
            const itemGroupId = itemId.split('/')[0]
            if (!itemGroupId) {
                return ''
            }
            const groupTemplate = this.#elementPropertiesTemplate.get(itemGroupId) as IndexedPropertyGroup

            // Store the item's new value
            const errorMsg = await this.#updateElementProperties(value, itemId, celldlObject, groupTemplate)
            if (errorMsg) {
                return errorMsg
            }

            // Has the CellDLObject's type changed?
            if (itemId === BG_ELEMENT_TYPE_ITEM && value.newValue !== value.oldValue) {
                const pluginData = (<PluginData>celldlObject.pluginData(this.id))
                for (const propertyGroup of componentProperties) {
                    if (propertyGroup.groupId === BG_PROPERTY_GROUP_ID.ElementProperties) {
                        // Possible element types depend on the component's domain so recalculate
                        const elementTypeItem = propertyGroup.items[ELEMENT_TYPE_INDEX]!
                        const possibleValues = this.#elementTypePossibleValues(celldlObject, pluginData.baseComponent)
                        elementTypeItem.possibleValues = possibleValues
                        break
                    }
                }
                const elementTemplate = pluginData.elementTemplate
                for (const groupTemplate of this.#elementPropertiesTemplate.values()) {
                    const componentGroup = componentProperties[groupTemplate.index] as PropertyGroup
                    if (groupTemplate.groupId === BG_PROPERTY_GROUP_ID.ElementInitialValue) {
                        // Remove any existing initial value
                        componentGroup.items.length = 0
                        this.#deleteElementValue(celldlObject)
                        // And add an item if the new element has an initial value
                        if (elementTemplate?.value) {
                            this.#setElementValue(elementTemplate.value, componentGroup, celldlObject)
                        }
                    } else if (componentGroup.groupId === BG_PROPERTY_GROUP_ID.ElementParameters) {
                        // Remove any existing parameter values
                        componentGroup.items.length = 0
                        this.#deleteVariableItems(celldlObject, componentGroup)
                        // And add items if the element has parameters
                        if (elementTemplate?.parameters) {
                            this.#setVariableItems(elementTemplate.parameters, componentGroup)
                            this.#loadVariableItems(celldlObject, componentGroup)
                            // A new template's parameters start at a stored value, not an unstored 0
                            this.#storeDefaultParameters(celldlObject, componentGroup, elementTemplate)
                        }
                    } else if (componentGroup.groupId === BG_PROPERTY_GROUP_ID.ElementVariables) {
                        // Remove any existing variable values
                        componentGroup.items.length = 0
                        this.#deleteVariableItems(celldlObject, componentGroup)
                        // And add items if the element has variables
                        if (elementTemplate?.variables) {
                            this.#setVariableItems(elementTemplate.variables, componentGroup)
                            this.#loadVariableItems(celldlObject, componentGroup)
                        }
                    }
                }
            }
        }
        return ''
    }

    //==================================

    async updatedComponentStyling(celldlObject: CellDLObject, styling: Styling) {
        const pluginData = (<PluginData>celldlObject.pluginData(this.id))
        if (styling.fillStyle) {   // we don't need styleType, just the presence of `fillStyle` in the `styling` object
            const fillString = styling.fillStyle
            if (fillString !== pluginData.fillString) {
                pluginData.fillString = fillString
                await this.#updateSvgElement(celldlObject, pluginData.species, pluginData.location)
            }
        }
        if (styling.pathStyle) {
            celldlObject.celldlSvgElement!.setStyle(styling)
        }
    }

    //==================================

    /** Stores an item's new value, returning why it could not be stored, or `''`. */
    async #updateElementProperties(value: ValueChange, itemId: string,
                                   celldlObject: CellDLObject, groupTemplate: IndexedPropertyGroup): Promise<string> {
        const pluginData = (<PluginData>celldlObject.pluginData(this.id))
        let errorMsg = ''

        // check all groups belonging to the PROPERTIES_PANEL
        if (groupTemplate.groupId === BG_PROPERTY_GROUP_ID.ElementProperties) {
            for (const item of groupTemplate.items) {
                if (itemId === item.itemId) {
                    alert.clear()
                    if (itemId === BG_ELEMENT_TYPE_ITEM) {
                        await this.#updateElementType(item, value, celldlObject)
                    } else if (itemId === BG_ELEMENT_SPECIES_ITEM) {
                        errorMsg = await this.#updateSvgElement(celldlObject, value.newValue, pluginData.location)
                        if (errorMsg === '') {
                            updateItemProperty(item.property, value, celldlObject)
                            pluginData.species = value.newValue
                        } else {
                            alert.error(errorMsg)
                        }
                    } else if (itemId === BG_ELEMENT_LOCATION_ITEM) {
                        //pluginData.location = value.newValue
                        errorMsg = await this.#updateSvgElement(celldlObject, pluginData.species, value.newValue)
                        if (errorMsg === '') {
                            updateItemProperty(item.property, value, celldlObject)
                            pluginData.location = value.newValue
                        } else {
                            alert.error(errorMsg)
                        }
                    }
                    break
                }
            }
        } else if (groupTemplate.groupId === BG_PROPERTY_GROUP_ID.ElementInitialValue) {
            if (itemId === BG_ELEMENT_VALUE_ITEM) {
                alert.clear()
                this.#updateElementValue(value, celldlObject)
            }
        } else if (groupTemplate.groupId === BG_PROPERTY_GROUP_ID.ElementParameters
                || groupTemplate.groupId === BG_PROPERTY_GROUP_ID.ElementVariables) {
            this.#updateVariableProperties(value, groupTemplate.groupId, itemId, celldlObject, pluginData.elementTemplate)
        }
        return errorMsg
    }

    //==================================

    #updateElementValue(value: ValueChange, celldlObject: CellDLObject) {
        const objectUri = celldlObject.uri.toString()

        celldlObject.rdfStore.update(`${SPARQL_PREFIXES}
            PREFIX : <${this.#currentDocumentUri}#>

            DELETE {
                ${objectUri} bgf:hasValue ?value
            }
            WHERE {
                ${objectUri} bgf:hasValue ?value
            }`)
        const newValue = String(value.newValue).trim()
        const elementTemplate = (<PluginData>celldlObject.pluginData(this.id)).elementTemplate
        const variable = elementTemplate!.value
        if (newValue) {
            celldlObject.rdfStore.update(`${SPARQL_PREFIXES}
                PREFIX : <${this.#currentDocumentUri}#>

                INSERT DATA {
                   ${objectUri} bgf:hasValue "${newValue} ${variable!.units}"^^cdt:ucum .
                }
            `)
        }
    }

    //==================================

    #updateVariableProperties(value: ValueChange, groupId: string, itemId: string, celldlObject: CellDLObject,
                              elementTemplate?: ElementTemplate) {
        const varName = itemId.split('/')[1]
        if (!elementTemplate || !varName) {
            return
        }
        const objectUri = celldlObject.uri.toString()
        const predicate = (groupId === BG_PROPERTY_GROUP_ID.ElementParameters)
                        ? 'bgf:parameterValue'
                        : 'bgf:VariableValue'
        celldlObject.rdfStore.update(`${SPARQL_PREFIXES}
            PREFIX : <${this.#currentDocumentUri}#>

            DELETE WHERE {
                ${objectUri} ${predicate} ?pv .
                ?pv bgf:varName "${varName}" ;
                    bgf:hasValue ?value .
            }`)
        const variable = (groupId === BG_PROPERTY_GROUP_ID.ElementParameters)
                       ? elementTemplate.parameters.get(varName)
                       : elementTemplate.variables.get(varName)
        if (!variable) {
            return
        }
        celldlObject.rdfStore.update(`${SPARQL_PREFIXES}
            PREFIX : <${this.#currentDocumentUri}#>

            INSERT DATA {
                ${objectUri} ${predicate} _:pv .
                _:pv bgf:varName "${varName}" ;
                     bgf:hasValue "${value.newValue} ${variable.units}"^^cdt:ucum .
            }
        `)
// Check units...
//            ucum.isConvertible(units1: string, units2: string)
    }

    //==================================

    async #updateSvgElement(celldlObject: CellDLObject,
                            species: string|undefined, location: string|undefined): Promise<string> {
        // Update and redraw the component's SVG element

        const pluginData = (<PluginData>celldlObject.pluginData(this.id))
        const baseComponent = pluginData.baseComponent
        const symbol = pluginData?.symbol
                     ?? pluginData.elementTemplate?.symbol
                     ?? baseComponent.symbol
        let imageData = ''
        try {
            imageData = svgImageData(symbol, species, location,
                                     baseComponent.style, pluginData.fillString)
        // biome-ignore lint/suspicious/noExplicitAny: <>
        } catch (error: any) {
            return (error as Error).message
        }
        if (imageData) {
            const celldlSvgElement = celldlObject.celldlSvgElement!
            await celldlSvgElement.updateImageElement(imageData)
            celldlSvgElement.redraw()
        }
        return ''
    }

    //==========================================================================

    /**
     * What a bond graph component is, for listing it outside the Properties panel.
     *
     * @param celldlObject A CellDL object.
     * @returns `undefined` when the object is not a bond graph component.
     */
    describeElement(celldlObject: CellDLObject): BGElementDescription|undefined {
        if (celldlObject.isConnection) {
            return
        }
        const pluginData = <PluginData>celldlObject.pluginData(this.id)
        const baseComponent = pluginData.baseComponent
        if (!pluginData.managed || !baseComponent?.type) {
            return
        }
        const elementTemplate = pluginData.elementTemplate
        return {
            kind: baseComponent.type,
            kindName: baseComponent.name || $rdf.namespaceMap.getCurie(baseComponent.type),
            junctionType: baseComponent.junctionType,
            isBondElement: baseComponent.isBondElement,
            template: elementTemplate?.type,
            templateName: elementTemplate?.name,
            symbol: pluginData.symbol ?? elementTemplate?.symbol ?? baseComponent.symbol,
            valueUnits: elementTemplate?.value?.units
        }
    }

    /** The physical domain of an element template, given its type. */
    templateDomain(type: string): string|undefined {
        return this.#elementTemplates.get(type)?.domain || undefined
    }

    /**
     * Brings a component's plugin data, domain, SVG and name up to date with its
     * RDF, after the RDF has been changed directly (e.g. by undo).
     *
     * @param celldlObject A CellDL object.
     */
    async refreshObject(celldlObject: CellDLObject) {
        if (celldlObject.isConnection) {
            return
        }
        const pluginData = <PluginData>celldlObject.pluginData(this.id)
        if (!pluginData.managed) {
            return
        }
        const oldTemplate = pluginData.elementTemplate?.type
        const fillString = pluginData.fillString
        for (const key of Object.keys(pluginData)) {
            delete (pluginData as unknown as Record<string, unknown>)[key]
        }
        Object.assign(pluginData, this.getPluginData(celldlObject))
        if (fillString !== undefined) {
            pluginData.fillString = fillString
        }
        celldlObject.rdfStore.query(`${SPARQL_PREFIXES}
            PREFIX : <${this.#currentDocumentUri}#>
            SELECT ?species ?location WHERE {
                OPTIONAL { ${celldlObject.uri.toString()} bgf:hasSpecies ?species }
                OPTIONAL { ${celldlObject.uri.toString()} bgf:hasLocation ?location }
            }`
        ).forEach((r: Map<string, $rdf.Term>) => {
            pluginData.species = r.get('species')?.value
            pluginData.location = r.get('location')?.value
        })
        const elementTemplate = pluginData.elementTemplate
        if (elementTemplate?.type !== oldTemplate) {
            this.#domainGraph.setDomain(celldlObject.uri.value, elementTemplate?.domain)
        }
        celldlObject.setName(this.#getName(elementTemplate?.type ?? pluginData.baseComponent.type))
        await this.#updateSvgElement(celldlObject, pluginData.species, pluginData.location)
    }

    //==========================================================================

    styleRules(): string {
        return '.celldl-Connection.bondgraph.arrow { marker-end:url(#connection-end-arrow-bondgraph) }'
    }

    svgDefinitions(): string {
        return arrowMarker('connection-end-arrow-bondgraph', 'bondgraph')
    }

    //==========================================================================

    #elementTypePossibleValues(celldlObject: CellDLObject, baseComponent: BGBaseComponent): IUiJsonDiscreteInputPossibleValue[] {
        const possibleValues: IUiJsonDiscreteInputPossibleValue[] = []
        const elementTemplates = this.#baseComponentToElementTemplates.get(baseComponent.type) || []
        possibleValues.push({  // `baseComponent` and `templates` are possible values
            name: baseComponent.name || '',
            value: baseComponent.type,
            emphasise: true
        })
        if (baseComponent.isBondElement) {
            const domain = this.#domainGraph.getDomain(celldlObject.uri.value)
            possibleValues.push(
                ...elementTemplates
                        .filter(et => // Filter templates by component's domain
                                      // but only if it's connected
                                    celldlObject.numConnections === 0
                                || !domain
                                ||  domain === et.domain)
                        .map(et => {
                                return {
                                    name: et.name,
                                    value: et.type
                                }
                            })
            )
        }
        return possibleValues
    }

    #getElementTypeItem(celldlObject: CellDLObject, itemTemplate: ItemDetails, pluginData: PluginData): ItemDetails {
        const baseComponent = pluginData.baseComponent
        const discreteItem = <IUiJsonDiscreteInput>{...itemTemplate}
        discreteItem.possibleValues = this.#elementTypePossibleValues(celldlObject, baseComponent)
        const discreteValue = pluginData.elementTemplate
                            ? pluginData.elementTemplate.type
                            : baseComponent.type
        const index = discreteItem.possibleValues.findIndex(v => String(discreteValue) === String(v.value))
        if (index >= 0) {
            discreteItem.value = discreteItem.possibleValues[index]
        }
        return discreteItem as ItemDetails
    }

    //==========================================================================

    async #updateElementType(_itemTemplate: ItemDetails, value: ValueChange,
                       celldlObject: CellDLObject) {
        const objectUri = celldlObject.uri.toString()
        const pluginData = (<PluginData>celldlObject.pluginData(this.id))
        const baseComponent = pluginData.baseComponent

        const deleteTriples: string[] = []
        if (this.#elementTemplates.has(value.oldValue)) {
            deleteTriples.push(`${objectUri} a <${value.oldValue}>`)
            deleteTriples.push(`${objectUri} a <${baseComponent.type}>`)
            delete pluginData.elementTemplate
        } else if (this.#baseComponents.has(value.oldValue)) {
            deleteTriples.push(`${objectUri} a <${value.oldValue}>`)
        }
        const oldSymbol = pluginData.symbol
        if (oldSymbol) {
            deleteTriples.push(`${objectUri} bgf:hasSymbol "${oldSymbol}"`)
        }
        celldlObject.rdfStore.update(`${SPARQL_PREFIXES}
            PREFIX : <${this.#currentDocumentUri}#>
            DELETE DATA {
                ${deleteTriples.join('\n')}
            }`)

        celldlObject.rdfStore.update(`${SPARQL_PREFIXES}
            PREFIX : <${this.#currentDocumentUri}#>
            INSERT DATA { ${objectUri} a <${value.newValue}> }
        `)
        let newDomain: string|undefined
        let newSymbol: string|undefined
        if (this.#elementTemplates.has(value.newValue)) {
            pluginData.elementTemplate = this.#elementTemplates.get(value.newValue)!
            newDomain = pluginData.elementTemplate.domain
            newSymbol = pluginData.elementTemplate.symbol
        }
        this.#domainGraph.setDomain(celldlObject.uri.value, newDomain)
        if (newSymbol === undefined) {
            newSymbol = baseComponent.symbol
        }
        if (newSymbol) {
            pluginData.symbol = newSymbol
            celldlObject.rdfStore.update(`${SPARQL_PREFIXES}
                PREFIX : <${this.#currentDocumentUri}#>
                INSERT DATA { ${objectUri} bgf:hasSymbol "${newSymbol}" }
            `)
            await this.#updateSvgElement(celldlObject, pluginData.species, pluginData.location)
        }
        celldlObject.setName(this.#getName(value.newValue))
    }

    //==========================================================================
    //==========================================================================

    #query(sparql: string) {
        return this.#rdfStore.query(`${SPARQL_PREFIXES}${sparql}`)
    }

    #loadDomains() {
        this.#query(`
            SELECT ?domain
                ?flowName ?flowUnits
                ?potentialName ?potentialUnits
                ?quantityName ?quantityUnits
            WHERE {
              ?domain a bgf:PhysicalDomain ;
                bgf:hasFlow [
                    bgf:varName ?flowName ;
                    bgf:hasUnits ?flowUnits
                ] ;
                bgf:hasPotential [
                    bgf:varName ?potentialName ;
                    bgf:hasUnits ?potentialUnits
                ] ;
                bgf:hasQuantity [
                    bgf:varName ?quantityName ;
                    bgf:hasUnits ?quantityUnits
                ] .
            }`
        ).forEach((r: Map<string, $rdf.Term>) => {
            const domain = r.get('domain')!
            this.#physicalDomains.set(domain.value, {
                id: domain.value,
                flow: {
                    name: r.get('flowName')!.value,
                    units: r.get('flowUnits')!.value,
                },
                potential: {
                    name: r.get('potentialName')!.value,
                    units: r.get('potentialUnits')!.value,
                },
                quantity: {
                    name: r.get('quantityName')!.value,
                    units: r.get('quantityUnits')!.value,
                },
            })
        })
    }

    #initialiseComponentLibrary() {
        const elements: Set<string> = new Set()
        this.#query(`
            SELECT ?element WHERE {
                ?element rdfs:subClassOf ?base .
                ?base rdfs:subClassOf* ?bgClass .
                FILTER (
                   sameTerm(?bgClass, bgf:BondElement)
                || sameTerm(?bgClass, bgf:JunctionStructure))
            } order by ?element`
        ).forEach((r: Map<string, $rdf.Term>) => {
            const element = r.get('element')!
            elements.add(element.value)
        })
        for (const defn of BONDGRAPH_COMPONENT_DEFINITIONS) {
            const template = definitionToLibraryTemplate(defn)
            if (elements.has(template.type)) {
                this.#componentLibrary.templates.push(template)
                this.#componentTemplates.set(template.id, template)
            }
        }
        if (this.#componentLibrary.templates.length === 0) {
            window.alert('Cannot find any bond graph template definitions...')
        }
    }

    #loadBaseComponents() {
        // Get information about the components in the add component tool
        let lastElement: $rdf.Term|undefined
        this.#query(`
            SELECT ?element ?label ?base ?bgClass WHERE {
                ?element rdfs:subClassOf ?base .
                ?base rdfs:subClassOf* ?bgClass .
                OPTIONAL { ?element rdfs:label ?label }
                OPTIONAL {
                    { ?element bgf:hasDomain ?domain }
                UNION
                    { ?base bgf:hasDomain ?domain }
                }
                FILTER (
                  !bound(?domain)
                  && (sameTerm(?bgClass, bgf:BondElement )
                   || sameTerm(?bgClass, bgf:JunctionStructure )))
            } order by ?element`
        ).forEach((r: Map<string, $rdf.Term>) => {
            const element = r.get('element')!
            const label = r.get('label')
            const nodeType = r.get('base')!
            const bgClass = r.get('bgClass')!
            let junctionType: string|undefined
            /*
            element             nodeType               bgClass
            ==================  =====================  =====================
            bgf:OneStorageNode  bgf:FlowStore          bgf:BondElement
            bgf:OneStorageNode  bgf:OneNode            bgf:JunctionStructure
            bgf:QuantityStore   bgf:BondElement        bgf:BondElement
            bgf:Reaction        bgf:Dissipator         bgf:BondElement
            bgf:TransformNode   bgf:JunctionStructure  bgf:JunctionStructure
            bgf:ZeroNode        bgf:JunctionStructure  bgf:JunctionStructure
            */
            if (bgClass.value === BGF.uri('JunctionStructure').value) {
                if (nodeType.value === BGF.uri('JunctionStructure').value) {
                    junctionType = element.value
                } else {
                    junctionType = nodeType.value
                }
            }
            if (lastElement?.value !== element.value) {
                for (const componentTemplate of this.#componentTemplates.values()) {
                    if (element.value === componentTemplate.type) {
                        let component = this.#baseComponents.get(componentTemplate.type)
                        if (!component) {
                            if (label) {    // Ontology labels override component names
                                componentTemplate.name = label.value
                            }
                            component = new BGBaseComponent(componentTemplate,
                                            label ? label.value : $rdf.namespaceMap.getCurie(element.value),
                                            bgClass.value)
                            this.#baseComponents.set(element.value, component)
                        }
                        componentTemplate.component = component
                        if (junctionType) {
                            component.setJunctionType(junctionType)
                        }
                    }
                }
                lastElement = element
            } else {
                const component = this.#baseComponents.get(element.value)
                if (component && junctionType) {
                    component.setJunctionType(junctionType)
                }
            }
        })
    }

    #getDiffVariable(domain: PhysicalDomain, relation: string): Variable|undefined {
        relation = relation.replace(/\n \s*/g, '')  // Remove blanks and new lines
        const diffStateVar = relation.match(/<apply><diff\/><bvar><ci>[^<]*<\/ci><\/bvar><ci>([^<]*)<\/ci><\/apply>/)
        if (diffStateVar) {
            const symbol = diffStateVar[1]
            if (symbol === domain.quantity.name) {
                return domain.quantity
            } else if (symbol === domain.flow.name) {
                return domain.flow
            } else if (symbol === domain.potential.name) {
                return domain.potential
            }
        }
    }

    #assignTemplates() {
        for (const [base, component] of this.#baseComponents.entries()) {
            if (component.type === this.#transformNodeType) {
                if (!this.#baseComponentToElementTemplates.has(component.type)) {
                    this.#baseComponentToElementTemplates.set(component.type, [])
                }
                const elementTemplate: ElementTemplate = {
                    type: component.type,
                    domain: '',
                    name: component.name || $rdf.namespaceMap.getCurie(component.type),
                    parameters: new Map(),
                    variables: new Map(),
                    defaultStyle: component.style,
                    symbol: component.symbol,
                    baseComponent: component,
                    value: { name: 'k', units: '', value: '1' },
                }
                this.#elementTemplates.set(elementTemplate.type, elementTemplate)
                this.#baseComponentToElementTemplates.get(component.type)!.push(elementTemplate)
                continue
            }
            this.#query(`
                SELECT ?element ?label ?symbol ?domain ?relation WHERE {
                    ?element
                        rdfs:subClassOf* ?subType ;
                        rdfs:subClassOf* <${base}> .
                    ?subType bgf:hasDomain ?domain .
                    OPTIONAL { ?element rdfs:label ?label }
                    OPTIONAL { ?element bgf:hasSymbol ?symbol }
                    OPTIONAL { ?subType bgf:constitutiveRelation ?relation }
                    FILTER (
                        exists { ?element a bgf:ElementTemplate }
                     || exists {<${base}> a bgf:CompositeElement}
                    )
                  } order by ?label`
            ).forEach((r: Map<string, $rdf.Term>) => {
                const element = r.get('element')!
                const domainId = r.get('domain')!.value
                const label = r.get('label')
                const symbol = r.get('symbol')
                if (!this.#baseComponentToElementTemplates.has(component.type)) {
                    this.#baseComponentToElementTemplates.set(component.type, [])
                }
                const elementTemplate: ElementTemplate = {
                    type: element.value,
                    domain: domainId,
                    name: label ? label.value : $rdf.namespaceMap.getCurie(element.value),
                    parameters: new Map(),
                    variables: new Map(),
                    defaultStyle: component.style,
                    symbol: symbol ? symbol.value : component.symbol,
                    baseComponent: component,
                }
                const domain = this.#physicalDomains.get(domainId)
                if (domain) {
                    if (component.type === BGF.uri('PotentialSource').value) {
                        elementTemplate.value = domain.potential
                        elementTemplate.units = domain.potential.units
                    } else if (component.type === BGF.uri('FlowSource').value) {
                        elementTemplate.value = domain.flow
                        elementTemplate.units = domain.flow.units
                    } else if (component.type === BGF.uri('Reaction').value
                            || component.type === BGF.uri('Resistance').value) {
                        elementTemplate.units = domain.flow.units
                    } else {
                        const relation = r.get('relation')
                        if (relation) {
                            const differentiatedVariable = this.#getDiffVariable(domain, relation.value)
                            if (differentiatedVariable) {
                                elementTemplate.value = differentiatedVariable
                                elementTemplate.units = differentiatedVariable.units
                            }
                        }
                    }
                }
                this.#elementTemplates.set(elementTemplate.type, elementTemplate)
                this.#baseComponentToElementTemplates.get(component.type)!.push(elementTemplate)
            })
        }
    }

    #saveParametersAndStates(r: Map<string, $rdf.Term>) {
        const element = r.get('element')!
        const template = this.#elementTemplates.get(element.value)
        if (!template) return ;
        if (r.has('parameterName')) {
            const name = r.get('parameterName')!.value
            template.parameters.set(name, {
                name: name,
                units: r.get('parameterUnits')!.value
            })
        }
        if (r.has('variableName')) {
            const name = r.get('variableName')!.value
            template.variables.set(name, {
                name: name,
                units: r.get('variableUnits')!.value
            })
        }
    }

    #loadTemplateParameters() {
        // Find parameters and variables for Element templates
        this.#query(`
            SELECT ?element ?parameterName ?parameterUnits
                            ?variableName ?variableUnits
            WHERE {
                ?element a bgf:ElementTemplate .
                {
                    ?element bgf:hasParameter [
                        bgf:varName ?parameterName ;
                        bgf:hasUnits ?parameterUnits
                    ]
                }
                UNION
                {
                    ?element bgf:hasVariable [
                        bgf:varName ?variableName ;
                        bgf:hasUnits ?variableUnits
                    ]
                }
            } ORDER BY ?element ?parameterName ?variableName`
        ).forEach((r: Map<string, $rdf.Term>) => {
            this.#saveParametersAndStates(r)
        })
        // Find parameters and variables for Composite templates
        this.#query(`
            SELECT ?element ?parameterName ?parameterUnits
                            ?variableName ?variableUnits
            WHERE {
                ?element a bgf:CompositeTemplate ;
                    rdfs:subClassOf ?base .
                ?base a bgf:ElementTemplate .
                {
                    ?base bgf:hasParameter [
                        bgf:varName ?parameterName ;
                        bgf:hasUnits ?parameterUnits
                    ]
                }
                UNION
                {
                    ?base bgf:hasVariable [
                        bgf:varName ?variableName ;
                        bgf:hasUnits ?variableUnits
                    ]
                }
            } ORDER BY ?element ?parameterName ?variableName`
        ).forEach((r: Map<string, $rdf.Term>) => {
            this.#saveParametersAndStates(r)
        })
    }
}

//==============================================================================
//==============================================================================
