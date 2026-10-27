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
import { type BondEnd, type BondEndKind, type BondPorts, bondRule } from './bondrules'

import {
    BONDGRAPH_COMPONENT_DEFINITIONS,
    DEFAULT_LOCATION,
    DEFAULT_SPECIES,
    definitionToLibraryTemplate,
    svgImageData
} from './definitions'
import {
    type Annotation, ANNOTATION_PREDICATES, annotationText, planAnnotationChanges, readAnnotations, type Triple
} from './annotations'
import { type BondInfo, equationLatex, equationText, type NodeInfo, type SpeciesNode, type StepEquation, stepEquation } from './equations'
import { elementTemplatesQuery, styleOverrides, templateStyle } from './laws'
import { type MathNode, mathmlLatex, type SignedTerm, whereLatex, whereText } from './lawtext'
import { ELEMENT_CLASSES, type NameOverrides, type NamingElement, type NamingRule, previewNames } from './naming'
import { latexAsSvgString } from '#root/mathjax'
import type {
    BGComponentLibrary,
    BGLibraryComponentTemplate,
    BGElementStyle
} from './utils'
import { DomainGraph } from './domainGraph'
import {
    defaultSignalUse,
    drawSignalBonds,
    freeUnitsLabel,
    isSignalConnection,
    parseSignalUse,
    SIGNAL_BOND_CLASS,
    type SignalTarget,
    type SignalUse,
    signalUseOptions,
    signalUseValue,
    valueWithUnits
} from './signals'
import {
    effectiveUnits,
    IMPLICIT_UNIT_SYSTEM,
    NEW_DIAGRAM_UNIT_SYSTEM,
    rescaledValue,
    UNIT_SYSTEM_IRIS,
    UNIT_SYSTEM_PREDICATE,
    type UnitSystemId,
    unitSystemForIri
} from './unitsystem'

//==============================================================================

export const PLUGIN_ID = 'bondgraph-components'

// Bond ends' kinds, by base component type, for the direction rules
const BOND_END_KINDS: Map<string, BondEndKind> = new Map([
    ['QuantityStore', 'storage'],
    ['FlowStore', 'storage'],
    ['Resistance', 'dissipator'],
    ['Reaction', 'reaction'],
    ['PotentialSource', 'source'],
    ['FlowSource', 'source'],
    ['TransformNode', 'transform'],
    ['ZeroNode', 'zero'],
    ['OneNode', 'one'],
    ['ZeroStorageNode', 'composite'],
    ['OneStorageNode', 'composite'],
    ['OneResistanceNode', 'composite'],
    ['OneReactionNode', 'composite']
].map(([name, kind]) => [`${BGF_URI}${name}`, kind as BondEndKind]))

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

    get isSignalBlock() {
        return this.#bgClass === BGF.uri('SignalBlock').value
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
    units: string           // '' when the variable has no fixed units
    value?: string
    unitsOf?: string        // the template variable whose units it has (bgf:unitsOf)
}

/** Whether a variable has no fixed units, so takes those of its value or of what it is connected to */
function hasFreeUnits(variable: Variable): boolean {
    return !variable.units
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
    defaultStyle: BGElementStyle            // the base component's, with the template's bgf:hasStyle in place
    lawLabel?: string                       // the template's bgf:lawLabel: names its constitutive relation
    baseComponent: BGBaseComponent
    /** The template's declared ports (`bgf:hasPort`), by direction */
    ports?: BondPorts
    /** Its constitutive relation, as content MathML */
    relation?: string
    /** The signal inputs (`bgf:hasSignalInput`) a signal bond can set, in order */
    signalInputs: Variable[]
    /** A signal block's output (`bgf:hasSignalOutput`) */
    signalOutput?: Variable
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
    ElementVariables = 'bg-element-variables',
    SignalBond = 'bg-signal-bond'
}

const BG_PROPERTY_GROUP_IDS = Object.entries(BG_PROPERTY_GROUP_ID).map(([_, value]) => value as string)

export const BG_ELEMENT_TYPE_ITEM = `${BG_PROPERTY_GROUP_ID.ElementProperties}/bg-element-type`
export const BG_ELEMENT_SPECIES_ITEM = `${BG_PROPERTY_GROUP_ID.ElementProperties}/bg-element-species`
export const BG_ELEMENT_LOCATION_ITEM = `${BG_PROPERTY_GROUP_ID.ElementProperties}/bg-element-location`
export const BG_ELEMENT_PORT_TYPE_ITEM = `${BG_PROPERTY_GROUP_ID.ElementProperties}/bg-element-port-type`

export const BG_ELEMENT_VALUE_ITEM = `${BG_PROPERTY_GROUP_ID.ElementInitialValue}/bg-element-value`

// A connection's kind, and a signal bond's source variable, use of its target and exponent
export const BG_BOND_KIND_ITEM = `${BG_PROPERTY_GROUP_ID.SignalBond}/kind`
export const BG_SIGNAL_VARIABLE_ITEM = `${BG_PROPERTY_GROUP_ID.SignalBond}/variable`
export const BG_SIGNAL_USE_ITEM = `${BG_PROPERTY_GROUP_ID.SignalBond}/use`
export const BG_SIGNAL_EXPONENT_ITEM = `${BG_PROPERTY_GROUP_ID.SignalBond}/exponent`

const POWER_BOND = 'power'
const SIGNAL_BOND = 'signal'
const DEFAULT_SIGNAL_VARIABLE = 'default'

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
            },
            {
                itemId: BG_ELEMENT_PORT_TYPE_ITEM,
                property: BGF.uri('portType').value,
                name: 'Port type (as a module port)',
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
    }, {
        groupId: BG_PROPERTY_GROUP_ID.SignalBond,
        title: 'Bond',
        index: 4,
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

/** The value a parameter or variable gets when its element's template is chosen */
const DEFAULT_PARAMETER_VALUE = 1

/**
 * Defaults, by template (and its subclasses), for parameters that 1 would make singular: an elastic vessel's
 * `u = E(q - q_hat)/(q_bar - q)^2` needs its maximum volume above its unstressed one.
 */
const TEMPLATE_PARAMETER_DEFAULTS: Map<string, Record<string, number>> = new Map([
    [`${BGF_URI}ElasticVessel`, { q_bar: 3 }]
])

/** The predicate of an element's variable values, as BG-RDF and bg2cellml have it */
const VARIABLE_VALUE = 'bgf:variableValue'

/**
 * A readable name for a template that BG-RDF gives no label, from its type: `ChemicalPotential` → "Chemical potential",
 * and `NKETransporter` → "NKE transporter", keeping an acronym's capitals.
 */
function nameFromType(type: string): string {
    const words = $rdf.getFragment(type)
                       .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
                       .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
                       .split(' ')
                       .map((word, i) => (i > 0 && !/^[A-Z0-9]+$/.test(word)) ? word.toLowerCase() : word)
                       .join(' ')
    return words.charAt(0).toUpperCase() + words.slice(1)
}

const TRANSFORM_NODE_PROMPT = 'Ratio'

/** The base classes of the elements that a compartment gives a location (`isLocatedElement()`) */
const LOCATED_CLASSES = ['QuantityStore', 'FlowStore', 'PotentialSource', 'FlowSource']

/** The junctions that are not bond elements, which a signal bond can start at but not end at */
const JUNCTION_TYPES = ['ZeroNode', 'OneNode', 'TransformNode'].map(t => `${BGF_URI}${t}`)

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
    #locatedTypes: Set<string>|undefined
    #newDiagramUnitSystem: UnitSystemId = NEW_DIAGRAM_UNIT_SYSTEM
    // the object a path being drawn would reach by a signal bond, which then may take one more connection
    #pendingSignalTarget: string|undefined

    constructor() {
        for (const group of elementPropertiesTemplate()) {
            this.#elementPropertiesTemplate.set(group.groupId, group)
        }
        this.#rdfStore.addStatements(bgRdfStatements())
        this.#initialiseComponentLibrary()
        this.#loadDomains()
        this.#loadBaseComponents()
        this.#assignTemplates()
        this.#loadTemplatePorts()
        this.#loadTemplateParameters()
        this.#loadSignalVariables()
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

    openDiagram(uri: string, rdfStore: MetadataStore, newDiagram: boolean=false) {
        // We are creating a BondgraphModel
        rdfStore.add($rdf.namedNode(uri), $rdf.RDF.uri('type'), BGF.uri('BondgraphModel'))
        if (newDiagram) {
            rdfStore.add($rdf.namedNode(uri), $rdf.namedNode(UNIT_SYSTEM_PREDICATE),
                         $rdf.namedNode(UNIT_SYSTEM_IRIS[this.#newDiagramUnitSystem]))
        }

        this.#currentDocumentUri = uri
        this.#documentStore = rdfStore

        // Variable values saved under the editor's old predicate
        rdfStore.update(`${SPARQL_PREFIXES}
            DELETE { ?element bgf:VariableValue ?value }
            INSERT { ?element ${VARIABLE_VALUE} ?value }
            WHERE { ?element bgf:VariableValue ?value }`)

        // Add a copy of the BG-RDF framework as a **named graph**, to use when
        // finding BondElements and JunctionStructures
        const bgfGraph = $rdf.namedNode(BGF_ONTOLOGY_URI)
        for (const statement of this.#rdfStore.statements()) {
            rdfStore.add(statement.subject, statement.predicate, statement.object, bgfGraph)
        }
        this.#domainGraph = new DomainGraph(rdfStore, uri)
    }

    //======================================

    /** The unit system new diagrams are given. */
    get newDiagramUnitSystem(): UnitSystemId {
        return this.#newDiagramUnitSystem
    }
    set newDiagramUnitSystem(id: UnitSystemId) {
        this.#newDiagramUnitSystem = id
    }

    /**
     * The open diagram's unit system: its `pml:unitSystem`, SI when it has none, and `null` when the editor doesn't
     * know it (or it has more than one).
     */
    unitSystemId(): UnitSystemId|null {
        const store = this.#documentStore
        if (!store) {
            return IMPLICIT_UNIT_SYSTEM
        }
        const objects = store.statementsMatching($rdf.namedNode(this.#currentDocumentUri),
                                                 $rdf.namedNode(UNIT_SYSTEM_PREDICATE), null)
        if (objects.length === 0) {
            return IMPLICIT_UNIT_SYSTEM
        }
        return (objects.length === 1 && $rdf.isNamedNode(objects[0]!.object)) ? unitSystemForIri(objects[0]!.object.value)
                                                                              : null
    }

    /** The unit system values are stored in: the diagram's, or SI when the editor doesn't know it. */
    get unitSystem(): UnitSystemId {
        return this.unitSystemId() ?? IMPLICIT_UNIT_SYSTEM
    }

    /** Sets the open diagram's unit system, replacing any it has. */
    setUnitSystem(id: UnitSystemId) {
        const store = this.#documentStore
        if (store) {
            const documentNode = $rdf.namedNode(this.#currentDocumentUri)
            const predicate = $rdf.namedNode(UNIT_SYSTEM_PREDICATE)
            store.removeStatementsMatching(documentNode, predicate, null)
            store.add(documentNode, predicate, $rdf.namedNode(UNIT_SYSTEM_IRIS[id]))
        }
    }

    /**
     * Converts an element's stored values into a unit system's units, as the same quantities: "1 mol-1" is
     * "1e-15 fmol-1" in Cellular. A transform node's ratio, and a value that can't be converted, are kept.
     */
    rescaleValues(celldlObject: CellDLObject, id: UnitSystemId) {
        const pluginData = <PluginData>celldlObject.pluginData(this.id)
        if (!pluginData.managed || pluginData.baseComponent?.type === this.#transformNodeType) {
            return
        }
        const store = celldlObject.rdfStore
        const hasValue = BGF.uri('hasValue')
        const subjects: $rdf.SubjectType[] = [celldlObject.uri]
        for (const predicate of [BGF.uri('parameterValue'), BGF.uri('variableValue')]) {
            for (const statement of store.statementsMatching(celldlObject.uri, predicate, null)) {
                if ($rdf.isBlankNode(statement.object)) {
                    subjects.push(statement.object as $rdf.SubjectType)
                }
            }
        }
        for (const subject of subjects) {
            for (const statement of store.statementsMatching(subject, hasValue, null)) {
                const value = rescaledValue(statement.object.value, id)
                if (value !== undefined && $rdf.isLiteral(statement.object)) {
                    store.removeStatements([statement])
                    store.add(subject, hasValue,
                              $rdf.literal(value, $rdf.namedNode((statement.object as $rdf.Literal).datatype.value)))
                }
            }
        }
    }

    // A template's units in the diagram's unit system
    #units(code: string): string {
        return effectiveUnits(code, this.unitSystem)
    }

    // A stored value's units ("1 mmol" has "mmol"), if it has any: the element's own, or its parameter's or variable's
    #storedUnits(objectUri: string, variable?: { predicate: string, varName: string }): string|undefined {
        const pattern = variable === undefined ? `${objectUri} bgf:hasValue ?value`
                      : `${objectUri} ${variable.predicate} [ bgf:varName "${variable.varName}" ; bgf:hasValue ?value ]`
        for (const r of this.#documentStore?.query(`${SPARQL_PREFIXES}
            PREFIX : <${this.#currentDocumentUri}#>
            SELECT ?value WHERE { ${pattern} }`) ?? []) {
            const units = (r as Map<string, $rdf.Term>).get('value')?.value.trim().split(/\s+/)[1]
            if (units) {
                return units
            }
        }
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
        for (const predicate of ['bgf:hasSignalBlock', 'bgf:hasSignalBond']) {
            rdfStore.update(`${SPARQL_PREFIXES}
                DELETE WHERE { <${this.#currentDocumentUri}> ${predicate} ?uri }`)
        }

        const statements: string[] = []

        // The signal blocks and signal bonds, which bg2cellml reads from bgf:hasSignalBlock and bgf:hasSignalBond

        rdfStore.query(`${SPARQL_PREFIXES}
            SELECT DISTINCT ?uri
            WHERE {
                ?uri a ?type .
                ?type rdfs:subClassOf* bgf:SignalBlock
            }`, true)
        .forEach((r: Map<string, $rdf.Term>) => {
            statements.push(`<${this.#currentDocumentUri}> bgf:hasSignalBlock ${r.get('uri')!.toString()} .`)
        })
        rdfStore.query(`${SPARQL_PREFIXES}
            SELECT ?uri WHERE { ?uri a bgf:SignalBond }`, true)
        .forEach((r: Map<string, $rdf.Term>) => {
            statements.push(`<${this.#currentDocumentUri}> bgf:hasSignalBond ${r.get('uri')!.toString()} .`)
        })

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

        // Find the JunctionStructures in the diagram; a composite (a reaction with its One Node, a store with its
        // Zero Node) is a BondElement, whose junction bg2cellml makes from its template

        rdfStore.query(`${SPARQL_PREFIXES}
            PREFIX : <${this.#currentDocumentUri}#>

            SELECT ?uri
            WHERE {
                ?uri a ?type .
                ?type rdfs:subClassOf* bgf:JunctionStructure
                FILTER NOT EXISTS {
                    ?uri a ?elementType .
                    ?elementType rdfs:subClassOf* bgf:BondElement
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
                FILTER NOT EXISTS { ?bond a bgf:SignalBond }
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
            if (type === BGF.uri('OneNode').value) info.junction = 'one'
            else if (type === BGF.uri('ZeroNode').value) info.junction = 'zero'
            nodes.set(node, info)
            if ((reactions.has(type) || resistances.has(type)) && !steps.some(([n]) => n === node)) {
                steps.push([node, resistances.has(type)])
            }
            if ((stores.has(type) || sources.has(type)) && info.species && !species.some(n => n.id === node)) {
                species.push({ id: node, species: info.species, location: info.location, isSource: sources.has(type) })
            }
        }
        // in the order they were drawn
        bonds.sort((a, b) => (a.id ?? '') < (b.id ?? '') ? -1 : (a.id ?? '') > (b.id ?? '') ? 1 : 0)
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

    /** The 0-junction a store or source is bonded to, if any (a species' junction in a diagram drawn with them). */
    speciesJunction(node: string): string|undefined {
        const { bonds, nodes } = this.#diagramGraph()
        for (const b of bonds) {
            const other = b.source === node ? b.target : b.target === node ? b.source : undefined
            if (other !== undefined && nodes.get(other)?.junction === 'zero') return other
        }
    }

    /** The diagram's species stores and sources. */
    speciesNodes(): SpeciesNode[] {
        return this.#diagramGraph().species
    }

    /**
     * The diagram's bond elements with the variables bg2cellml gives them (./naming.ts): its flow and potential
     * (a reaction's u_f and u_r), its template's parameters and variables, then its own quantity.
     */
    namingElements(): NamingElement[] {
        const store = this.#documentStore
        if (!store) return []
        const prefix = `${this.#currentDocumentUri}#`
        const classes = ELEMENT_CLASSES.map(c => ({ uri: c.uri, types: this.#subclassesOf(c.uri) }))
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
            if (template.baseComponent.isSignalBlock) {
                // a block's own variables: its output and parameters
                elements.set(node, {
                    id: node, identifier: node.slice(prefix.length), elementClass: undefined, domain: template.domain,
                    label: r.get('symbol')?.value, species: undefined, location: undefined,
                    variables: [...new Set([template.signalOutput?.name ?? 'y', ...template.parameters.keys()])],
                    intrinsic: undefined
                })
                continue
            }
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

    /** The document's naming rules and explicit names (bgf:hasNamingRule, bgf:hasVariableName). */
    naming(): { rules: NamingRule[], overrides: NameOverrides } {
        const store = this.#documentStore
        const rules: NamingRule[] = [], overrides: NameOverrides = new Map()
        if (!store) return { rules, overrides }
        for (const r of store.query(`${SPARQL_PREFIXES}
            SELECT ?variable ?pattern ?class ?domain WHERE {
                <${this.#currentDocumentUri}> bgf:hasNamingRule ?rule .
                ?rule bgf:forVariable ?variable ; bgf:namePattern ?pattern .
                OPTIONAL { ?rule bgf:forElementClass ?class }
                OPTIONAL { ?rule bgf:forDomain ?domain }
            }`) as Map<string, $rdf.Term>[]) {
            rules.push({ variable: r.get('variable')!.value, pattern: r.get('pattern')!.value,
                         elementClass: r.get('class')?.value, domain: r.get('domain')?.value })
        }
        for (const r of store.query(`${SPARQL_PREFIXES}
            SELECT ?element ?variable ?name WHERE {
                ?element bgf:hasVariableName ?given .
                ?given bgf:forVariable ?variable ; bgf:cellmlName ?name .
            }`) as Map<string, $rdf.Term>[]) {
            overrides.set(`${r.get('element')!.value}|${r.get('variable')!.value}`, r.get('name')!.value)
        }
        return { rules, overrides }
    }

    /** Replace the document's naming rules and explicit names; they are saved with it. */
    setNaming(rules: NamingRule[], overrides: NameOverrides) {
        const store = this.#documentStore
        if (!store) return
        const literal = (s: string) => JSON.stringify(s)         // a quoted, escaped Turtle string
        store.update(`${SPARQL_PREFIXES}
            DELETE WHERE { <${this.#currentDocumentUri}> bgf:hasNamingRule ?rule . ?rule ?p ?o }`)
        store.update(`${SPARQL_PREFIXES}
            DELETE WHERE { ?element bgf:hasVariableName ?given . ?given ?p ?o }`)
        const statements: string[] = []
        rules.forEach((rule, k) => {
            statements.push(`<${this.#currentDocumentUri}> bgf:hasNamingRule _:rule${k} .`,
                            `_:rule${k} bgf:forVariable ${literal(rule.variable)} ; bgf:namePattern ${literal(rule.pattern)} .`)
            if (rule.elementClass) statements.push(`_:rule${k} bgf:forElementClass <${rule.elementClass}> .`)
            if (rule.domain) statements.push(`_:rule${k} bgf:forDomain <${rule.domain}> .`)
        })
        let k = 0
        for (const [key, name] of overrides) {
            if (name.trim() === '') continue
            const [element, variable] = key.split('|')
            statements.push(`<${element}> bgf:hasVariableName _:name${k} .`,
                            `_:name${k} bgf:forVariable ${literal(variable!)} ; bgf:cellmlName ${literal(name.trim())} .`)
            k += 1
        }
        if (statements.length) {
            store.update(`${SPARQL_PREFIXES}
                INSERT DATA { ${statements.join('\n')} }`)
        }
    }

    /** The annotations of the diagram's elements (./annotations.ts), by element URI. */
    annotations(): Map<string, Annotation> {
        const store = this.#documentStore
        if (!store) return new Map()
        const prefix = `${this.#currentDocumentUri}#`
        const triples: Triple[] = []
        for (const r of store.query(`${SPARQL_PREFIXES}
            SELECT ?s ?p ?o WHERE {
                ?s ?p ?o .
                FILTER (?p IN (${ANNOTATION_PREDICATES.map(p => `<${p}>`).join(', ')}))
            }`) as Map<string, $rdf.Term>[]) {
            const subject = r.get('s')!.value
            if (subject.startsWith(prefix)) {
                triples.push({ subject, predicate: r.get('p')!.value, object: r.get('o')!.value })
            }
        }
        return readAnnotations(triples)
    }

    /** Give these elements these annotations (removing any they no longer have); they are saved with the document. */
    setAnnotations(wanted: Map<string, Annotation>) {
        const store = this.#documentStore
        if (!store) return
        const { remove, add } = planAnnotationChanges(this.annotations(), wanted)
        const data = (triples: Triple[]) => triples.map(t => `<${t.subject}> <${t.predicate}> <${t.object}> .`).join('\n')
        if (remove.length) store.update(`DELETE DATA { ${data(remove)} }`)
        if (add.length) store.update(`INSERT DATA { ${data(add)} }`)
    }

    /**
     * The diagram's regions (./regions.ts): each store's and source's location, each step's species' locations
     * (several for a step between compartments), and the bonds between nodes.
     */
    regionLayout(): { regions: Map<string, string[]>, bonds: { a: string, b: string, id?: string, count: number }[] } {
        const { bonds, nodes, steps, species } = this.#diagramGraph()
        const regions = new Map<string, string[]>()
        for (const n of species) {
            if (n.location) regions.set(n.id, [n.location])
        }
        for (const [node, isResistance] of steps) {
            regions.set(node, stepEquation(node, isResistance, bonds, nodes).regions)
        }
        return { regions, bonds: bonds.map(b => ({ a: b.source, b: b.target, id: b.id, count: b.count })) }
    }

    /**
     * Whether an element takes its location from the compartment it is in: a store or a source (a chemostat), but
     * not a step (a reaction or transporter, which may join locations), a transformer or a junction.
     */
    isLocatedElement(celldlObject: CellDLObject): boolean {
        const description = this.describeElement(celldlObject)
        if (!description) {
            return false
        }
        // The framework's classes don't change, so are found once
        const located = this.#locatedTypes
                     ?? new Set(LOCATED_CLASSES.flatMap(base => [...this.#subclassesOf(BGF.uri(base).value)]))
        this.#locatedTypes = located
        return [description.template, description.kind].some(type => !!type && located.has(type))
    }

    /** An element's own location (its `bgf:hasLocation`), if it has one. */
    elementLocation(celldlObject: CellDLObject): string|undefined {
        let location: string|undefined
        celldlObject.rdfStore.query(`${SPARQL_PREFIXES}
            PREFIX : <${this.#currentDocumentUri}#>
            SELECT ?location WHERE { ${celldlObject.uri.toString()} bgf:hasLocation ?location }`
        ).forEach((r: Map<string, $rdf.Term>) => {
            location = r.get('location')?.value
        })
        return location
    }

    /** The element type of a component (its template's, else its base component's). */
    elementType(celldlObject: CellDLObject): string|undefined {
        const pluginData = <PluginData>celldlObject.pluginData(this.id)
        return pluginData.elementTemplate?.type ?? pluginData.baseComponent?.type
    }

    /** The physical domains' IRIs, as the templates define them. */
    physicalDomains(): string[] {
        return [...this.#physicalDomains.keys()]
    }

    /** The domains of the signal blocks' templates (BG-RDF's bgf:Signal), which have no power. */
    signalDomains(): string[] {
        return [...new Set((this.#baseComponentToElementTemplates.get(BGF.uri('SignalBlock').value) ?? [])
                                .map(et => et.domain).filter(Boolean))]
    }

    /** The element templates of base component `baseType`, with their domains (`''` for none). */
    baseElementTemplates(baseType: string): { type: string, name: string, domain: string }[] {
        return (this.#baseComponentToElementTemplates.get(baseType) ?? [])
                    .map(et => ({ type: et.type, name: et.name, domain: et.domain }))
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

    /**
     * Store the defaults the Properties panel shows for a new element's template, as choosing the template there
     * does: the template's default (usually 1) for each parameter and variable, and 0 for an initial value. Values
     * already stored are kept.
     */
    storeDefaultParameters(celldlObject: CellDLObject) {
        const elementTemplate = (<PluginData>celldlObject.pluginData(this.id)).elementTemplate
        if (!elementTemplate) {
            return
        }
        for (const [groupId, variables] of [[BG_PROPERTY_GROUP_ID.ElementParameters, elementTemplate.parameters],
                                            [BG_PROPERTY_GROUP_ID.ElementVariables, elementTemplate.variables]] as const) {
            const group: PropertyGroup = { groupId, items: [] }
            this.#setVariableItems(variables, group)
            this.#loadVariableItems(celldlObject, group)
            this.#storeDefaultParameters(celldlObject, group, elementTemplate)
        }
        const value = elementTemplate.value
        if (value && elementTemplate.baseComponent.type !== this.#transformNodeType) {
            const objectUri = celldlObject.uri.toString()
            const stored = celldlObject.rdfStore.query(`${SPARQL_PREFIXES}
                PREFIX : <${this.#currentDocumentUri}#>
                SELECT ?value WHERE { ${objectUri} bgf:hasValue ?value }`)
            if (stored.length === 0) {
                celldlObject.rdfStore.update(`${SPARQL_PREFIXES}
                    PREFIX : <${this.#currentDocumentUri}#>
                    INSERT DATA { ${objectUri} bgf:hasValue "0 ${hasFreeUnits(value) ? '1' : this.#units(value.units)}"^^cdt:ucum }`)
            }
        }
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
     * each symbol's CellML name (./naming.ts) with what the bonds make it: a reaction's u_f and u_r (the potentials
     * bonded to each side, a transformer's scaled by its ratio), a store's flow (its reactions' flows), a
     * resistance's potential (the difference across it), and its annotations (./annotations.ts). An element without
     * a law shows only its annotations ('' when it has none).
     */
    hoverHtml(celldlObject: CellDLObject): string {
        if (celldlObject.isConnection) return ''
        const templateType = (<PluginData>celldlObject.pluginData(this.id)).elementTemplate?.type
        const law = templateType ? this.#law(templateType) : null
        const id = celldlObject.uri.value
        const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        // an equation typeset as the law is, its text kept in data-text; the text itself if MathJax rejects it
        const typeset = (latex: string, text: string) => {
            let svg: string
            try { svg = latexAsSvgString(latex, true) } catch { svg = escape(text) }
            return `<div class="bg-law-line" data-text="${escape(text)}">${svg}</div>`
        }
        const annotated = annotationText(this.annotations().get(id))
        const annotation = annotated ? `<div class="bg-law-annotation">${escape(annotated)}</div>` : ''
        if (!law) return annotation ? `<div class="bg-law">${annotation}</div>` : ''
        const elements = this.namingElements()
        const element = elements.find(e => e.id === id)
        if (!element) return ''
        const { rules, overrides } = this.naming()
        const names = previewNames(elements, rules, overrides)
        const { bonds, nodes } = this.#diagramGraph()
        const byId = new Map(elements.map(e => [e.id, e]))
        const portName = (node: string, port: 'flow'|'potential') => {
            const e = byId.get(node)
            const domain = e?.domain ? this.#physicalDomains.get(e.domain) : undefined
            const symbol = port === 'flow' ? (domain?.flow.name ?? 'v') : (domain?.potential.name ?? 'u')
            return names.get(`${node}|${symbol}`) ?? ''
        }
        // what the bonds make a symbol, left out when it is bonded to something unnamed, such as a junction
        const knownTerms = (terms?: SignedTerm[]) => terms?.every(t => t.name !== '') ? terms : undefined
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
            symbol, name: names.get(`${id}|${symbol}`) ?? symbol, is: knownTerms(connected.get(symbol))
        }))
        const whereLatexLines = whereLatex(where)
        const step = this.reactionEquations().find(eq => eq.id === id)
        return '<div class="bg-law">'
            + (step ? `<div class="bg-law-equation">${typeset(equationLatex(step), equationText(step))}</div>` : '')
            + annotation
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
        if (pluginData.baseComponent?.isBondElement || pluginData.baseComponent?.isSignalBlock) {
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
        if (pluginData.baseComponent?.isSignalBlock) {
            return      // no power, so no physical domain
        }
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
        const uri = connection.uri.toString()
        // A connection already in the document (opened, or put back by undo) keeps its kind; a new one is a signal
        // bond when either end is a signal block or signal bonds are being drawn
        const isNew = this.#bondQuery(connection, 'bgf:hasSource ?value').length === 0
        const signal = isNew ? this.#isSignalPair(connection.source!, connection.target!) : this.isSignalBond(connection)
        this.#pendingSignalTarget = undefined
        if (!signal) {
            this.#domainGraph.addEdge(connection.uri.value, [connection.source!.uri.value, connection.target!.uri.value])
        }
        connection.rdfStore.update(`${SPARQL_PREFIXES}
            PREFIX : <${this.#currentDocumentUri}#>
            INSERT DATA {
                ${uri} bgf:hasSource ${connection.source!.uri.toString()} .
                ${uri} bgf:hasTarget ${connection.target!.uri.toString()} .
            }
        `)
        if (signal && isNew) {
            this.#makeSignalBond(connection)
        }
        this.#markSignalBond(connection, signal)
    }

    //======================================

    /** Whether a connection is a signal bond (`a bgf:SignalBond`). */
    isSignalBond(connection: CellDLObject): boolean {
        return connection.rdfStore.query(`${SPARQL_PREFIXES}
            PREFIX : <${this.#currentDocumentUri}#>
            SELECT ?bond WHERE { ${connection.uri.toString()} a bgf:SignalBond . BIND(1 AS ?bond) }`).length > 0
    }

    // Whether a new connection between these objects would be a signal bond
    #isSignalPair(source: CellDLObject, target: CellDLObject): boolean {
        return isSignalConnection({
            sourceIsBlock: !!(<PluginData>source.pluginData(this.id)).baseComponent?.isSignalBlock,
            targetIsBlock: !!(<PluginData>target.pluginData(this.id)).baseComponent?.isSignalBlock,
            drawingSignals: drawSignalBonds.value
        })
    }

    // The values of a predicate of a bond (`pattern` binds ?value)
    #bondQuery(connection: CellDLObject, pattern: string): string[] {
        return connection.rdfStore.query(`${SPARQL_PREFIXES}
            PREFIX : <${this.#currentDocumentUri}#>
            SELECT ?value WHERE { ${connection.uri.toString()} ${pattern} }`)
            .map((r: Map<string, $rdf.Term>) => r.get('value')!.value)
    }

    // Draws a signal bond dashed, with an arrowhead at its target (or a power bond as one)
    #markSignalBond(connection: CellDLConnection, signal: boolean) {
        const svgElement = connection.celldlSvgElement?.svgElement
        if (svgElement) {
            for (const element of [svgElement, ...Array.from(svgElement.querySelectorAll('path'))]) {
                element.classList.toggle(SIGNAL_BOND_CLASS, signal)
            }
        }
    }

    // Types a connection as a signal bond, setting what it does to its target by default
    #makeSignalBond(connection: CellDLConnection) {
        connection.rdfStore.update(`${SPARQL_PREFIXES}
            PREFIX : <${this.#currentDocumentUri}#>
            INSERT DATA { ${connection.uri.toString()} a bgf:SignalBond }`)
        const connected = this.#connectedSignalInputs(connection.target!, connection)
        this.#setSignalUse(connection, defaultSignalUse(this.#signalTarget(connection.target!), connected))
    }

    // Removes what makes a connection a signal bond
    #clearSignalBond(connection: CellDLObject) {
        const uri = connection.uri.toString()
        for (const pattern of [`${uri} a bgf:SignalBond`, `${uri} bgf:signalVariable ?v`, `${uri} bgf:signalInput ?v`,
                               `${uri} bgf:modulates ?v`, `${uri} bgf:modulationExponent ?v`]) {
            connection.rdfStore.update(`${SPARQL_PREFIXES}
                PREFIX : <${this.#currentDocumentUri}#>
                DELETE WHERE { ${pattern} }`)
        }
    }

    /** What a signal bond's target offers it: its template's signal inputs and parameters, and a source's value. */
    #signalTarget(target: CellDLObject): SignalTarget {
        const pluginData = <PluginData>target.pluginData(this.id)
        const template = pluginData.elementTemplate
        const domain = template ? this.#physicalDomains.get(template.domain) : undefined
        const baseType = pluginData.baseComponent?.type
        const sourceValue = baseType === BGF.uri('FlowSource').value ? (domain?.flow.name ?? 'v')
                          : baseType === BGF.uri('PotentialSource').value ? (domain?.potential.name ?? 'u')
                          : undefined
        return {
            inputs: template?.signalInputs.map(v => v.name) ?? [],
            parameters: [...(template?.parameters.keys() ?? [])],
            sourceValue
        }
    }

    // The signal inputs of `target` that signal bonds other than `except` set
    #connectedSignalInputs(target: CellDLObject, except?: CellDLObject): string[] {
        return target.rdfStore.query(`${SPARQL_PREFIXES}
            PREFIX : <${this.#currentDocumentUri}#>
            SELECT ?bond ?input WHERE {
                ?bond a bgf:SignalBond ; bgf:hasTarget ${target.uri.toString()} ; bgf:signalInput ?input
            }`)
            .filter((r: Map<string, $rdf.Term>) => r.get('bond')!.value !== except?.uri.value)
            .map((r: Map<string, $rdf.Term>) => r.get('input')!.value)
    }

    /** What a signal bond does to its target, as its RDF has it. */
    signalUse(connection: CellDLObject): SignalUse {
        const input = this.#bondQuery(connection, 'bgf:signalInput ?value')[0]
        if (input !== undefined) {
            return { signalInput: input }
        }
        const modulates = this.#bondQuery(connection, 'bgf:modulates ?value')[0]
        if (modulates !== undefined) {
            const exponent = Number(this.#bondQuery(connection, 'bgf:modulationExponent ?value')[0] ?? 1)
            return { modulates, exponent: exponent === -1 ? -1 : 1 }
        }
        return {}
    }

    /** Sets what a signal bond does to its target; an exponent of 1, the default, is left implicit. */
    setSignalUse(connection: CellDLObject, use: SignalUse) {
        this.#setSignalUse(connection, use)
    }

    #setSignalUse(connection: CellDLObject, use: SignalUse) {
        const uri = connection.uri.toString()
        for (const predicate of ['bgf:signalInput', 'bgf:modulates', 'bgf:modulationExponent']) {
            connection.rdfStore.update(`${SPARQL_PREFIXES}
                PREFIX : <${this.#currentDocumentUri}#>
                DELETE WHERE { ${uri} ${predicate} ?value }`)
        }
        const statements: string[] = []
        if ('signalInput' in use) {
            statements.push(`${uri} bgf:signalInput ${JSON.stringify(use.signalInput)} .`)
        } else if ('modulates' in use) {
            statements.push(`${uri} bgf:modulates ${JSON.stringify(use.modulates)} .`)
            if (use.exponent !== 1) {
                statements.push(`${uri} bgf:modulationExponent ${Math.round(use.exponent)} .`)
            }
        }
        if (statements.length) {
            connection.rdfStore.update(`${SPARQL_PREFIXES}
                PREFIX : <${this.#currentDocumentUri}#>
                INSERT DATA { ${statements.join('\n')} }`)
        }
    }

    /** The variable of its source a signal bond carries (bgf:signalVariable), if it names one. */
    signalVariable(connection: CellDLObject): string|undefined {
        return this.#bondQuery(connection, 'bgf:signalVariable ?value')[0]
    }

    /** Sets the variable of its source a signal bond carries; `undefined` for the source's default. */
    setSignalVariable(connection: CellDLObject, variable: string|undefined) {
        const uri = connection.uri.toString()
        connection.rdfStore.update(`${SPARQL_PREFIXES}
            PREFIX : <${this.#currentDocumentUri}#>
            DELETE WHERE { ${uri} bgf:signalVariable ?value }`)
        if (variable) {
            connection.rdfStore.update(`${SPARQL_PREFIXES}
                PREFIX : <${this.#currentDocumentUri}#>
                INSERT DATA { ${uri} bgf:signalVariable ${JSON.stringify(variable)} }`)
        }
    }

    /**
     * Makes a connection a signal bond (with its default use) or a power bond, returning why it can't be, or ''.
     * A power bond follows the power-bond rules; a signal bond can't end at a junction.
     */
    setBondKind(connection: CellDLConnection, signal: boolean): string {
        if (signal === this.isSignalBond(connection)) {
            return ''
        }
        const source = connection.source!, target = connection.target!
        if (signal) {
            const refusal = this.#signalBondStatus(target)
            if (refusal) {
                return refusal.alert!
            }
            this.#domainGraph.deleteEdge([source.uri.value, target.uri.value])
            this.#makeSignalBond(connection)
        } else {
            const sourceData = <PluginData>source.pluginData(this.id)
            const targetData = <PluginData>target.pluginData(this.id)
            if (sourceData.baseComponent?.isSignalBlock || targetData.baseComponent?.isSignalBlock) {
                return 'A signal block is connected by signal bonds only'
            }
            for (const end of [source, target]) {
                const limit = this.#powerPortLimit(end)
                if (this.#powerConnections(end).length >= limit) {
                    return 'Component has maximum number of connections'
                }
            }
            const status = this.#powerBondStatus(source, target)
            if (status?.alert) {
                return status.alert
            }
            this.#clearSignalBond(connection)
            this.#domainGraph.addEdge(connection.uri.value, [source.uri.value, target.uri.value])
        }
        this.#markSignalBond(connection, signal)
        return ''
    }

    // Why a signal bond can't end at `target`, if it can't
    #signalBondStatus(target: CellDLObject): ConnectionStatus|undefined {
        const baseType = (<PluginData>target.pluginData(this.id)).baseComponent?.type
        if (baseType && JUNCTION_TYPES.includes(baseType)) {
            return { alert: 'A signal bond ends at a bond element or a signal block, not a junction' }
        }
    }

    // An object's power bonds
    #powerConnections(celldlObject: CellDLObject): CellDLConnection[] {
        return celldlObject.connections.filter(c => !this.isSignalBond(c))
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
        // A signal bond crosses domains and follows none of the power-bond rules
        const managed = (<PluginData>sourceObject.pluginData(this.id)).managed
                     && (<PluginData>targetObject.pluginData(this.id)).managed
        if (managed && this.#isSignalPair(sourceObject, targetObject)) {
            const refusal = this.#signalBondStatus(targetObject)
            this.#pendingSignalTarget = refusal ? undefined : targetObject.id
            return refusal
        }
        this.#pendingSignalTarget = undefined
        return this.#powerBondStatus(sourceObject, targetObject)
    }

    // Why a power bond can't join two objects, if it can't
    #powerBondStatus(sourceObject: CellDLObject, targetObject: CellDLObject): ConnectionStatus|undefined {
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
        // Which way the bond points
        const bonds = [...new Set([...sourceObject.connections, ...targetObject.connections])]
            .filter(bond => bond.source && bond.target && !this.isSignalBond(bond))
            .map(bond => ({ source: this.bondEnd(bond.source!), target: this.bondEnd(bond.target!) }))
        const status = bondRule(this.bondEnd(sourceObject), this.bondEnd(targetObject), { bonds })
        if ('alert' in status) {
            return status
        }
    }

    /** What an object is as a bond's end, for the direction rules. */
    bondEnd(celldlObject: CellDLObject): BondEnd {
        const pluginData = <PluginData>celldlObject.pluginData(this.id)
        const baseType = pluginData.managed ? pluginData.baseComponent?.type : undefined
        const kind: BondEndKind = (baseType && BOND_END_KINDS.get(baseType)) || 'other'
        const ports = pluginData.elementTemplate?.ports
        return (kind === 'reaction' && ports) ? { id: celldlObject.id, kind, ports } : { id: celldlObject.id, kind }
    }

    connectionDeleted(connection: CellDLConnection) {
        if (this.isSignalBond(connection)) {
            this.#clearSignalBond(connection)
        } else {
            this.#domainGraph.deleteEdge([connection.source!.uri.value, connection.target!.uri.value])
        }
        const uri = connection.uri.toString()
        connection.rdfStore.update(`${SPARQL_PREFIXES}
            PREFIX : <${this.#currentDocumentUri}#>
            DELETE DATA {
                ${uri} bgf:hasSource ${connection.source!.uri.toString()} .
                ${uri} bgf:hasTarget ${connection.target!.uri.toString()} .
            }
        `)
    }

    /**
     * An element's connection limit: its power bonds' (its template's declared ports, if it has them, else its base
     * component's), its signal bonds, and one more when a signal bond is being drawn to or from it.
     */
    getMaxConnections(celldlObject: CellDLObject): number {
        const limit = this.#powerPortLimit(celldlObject)
        if (limit === Infinity || celldlObject.isConnection) {
            return limit
        }
        // from the RDF, which has an opened document's signal bonds before their connections are added
        const signals = celldlObject.rdfStore.query(`${SPARQL_PREFIXES}
            PREFIX : <${this.#currentDocumentUri}#>
            SELECT DISTINCT ?bond WHERE {
                ?bond a bgf:SignalBond .
                { ?bond bgf:hasSource ${celldlObject.uri.toString()} } UNION { ?bond bgf:hasTarget ${celldlObject.uri.toString()} }
            }`).length
        const drawing = (drawSignalBonds.value || this.#pendingSignalTarget === celldlObject.id) ? 1 : 0
        return limit + signals + drawing
    }

    /** A signal bond (one already typed, or a new one joining a signal block, or drawn as one) carries no power. */
    countsTowardsLimit(_celldlObject: CellDLObject, connection: CellDLConnection): boolean {
        const [source, target] = [connection.source, connection.target]
        return !(this.isSignalBond(connection)
              || (source && target && this.#bondQuery(connection, 'bgf:hasSource ?value').length === 0
                  && this.#isSignalPair(source, target)))
    }

    // How many power bonds an element can have
    #powerPortLimit(celldlObject: CellDLObject): number {
        const pluginData = (<PluginData>celldlObject.pluginData(this.id))
        const ports = pluginData.elementTemplate?.ports
        if (ports && ports.inward + ports.outward > 0) {
            return ports.inward + ports.outward
        }
        return pluginData.baseComponent?.numPorts || Infinity
    }

    //==========================================================================

    loadComponentProperties(componentProperties: PropertyGroup[], panelId: PANEL_ID, celldlObject: CellDLObject) {
        alert.clear()
        if (panelId === PANEL_ID.PROPERTIES_PANEL) {
            if (celldlObject.isConnection) {
                const group = componentProperties.find(g => g.groupId === BG_PROPERTY_GROUP_ID.SignalBond)
                if (group && (<PluginData>celldlObject.pluginData(this.id)).managed) {
                    this.#loadBondItems(<CellDLConnection>celldlObject, group)
                }
            } else {
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

    // A connection's items: its kind, and for a signal bond the variable it carries, what it does to its target
    // and, when it scales a parameter, the signal's power
    #loadBondItems(connection: CellDLConnection, group: PropertyGroup) {
        group.items.length = 0
        const signal = this.isSignalBond(connection)
        const kinds = [{ name: 'Power bond', value: POWER_BOND }, { name: 'Signal bond', value: SIGNAL_BOND }]
        group.items.push({
            itemId: BG_BOND_KIND_ITEM, property: $rdf.RDF.uri('type').value, name: 'Bond kind',
            possibleValues: kinds, value: kinds[signal ? 1 : 0]
        } as ItemDetails)
        if (!signal || !connection.source || !connection.target) {
            return
        }
        const sourceData = <PluginData>connection.source.pluginData(this.id)
        if (!sourceData.baseComponent?.isSignalBlock) {
            const domainId = sourceData.elementTemplate?.domain || this.#domainGraph.getDomain(connection.source.uri.value)
            const domain = domainId ? this.#physicalDomains.get(domainId) : undefined
            const names = [domain?.quantity.name ?? 'q', domain?.potential.name ?? 'u', domain?.flow.name ?? 'v']
            const options = [{ name: 'The source\'s default', value: DEFAULT_SIGNAL_VARIABLE },
                             ...names.map(name => ({ name: `The source's ${name}`, value: name }))]
            const chosen = this.signalVariable(connection) ?? DEFAULT_SIGNAL_VARIABLE
            group.items.push({
                itemId: BG_SIGNAL_VARIABLE_ITEM, property: BGF.uri('signalVariable').value, name: 'Carries',
                possibleValues: options, value: options.find(o => o.value === chosen) ?? options[0]
            } as ItemDetails)
        }
        const use = this.signalUse(connection)
        const uses = signalUseOptions(this.#signalTarget(connection.target))
        if (uses.length) {
            group.items.push({
                itemId: BG_SIGNAL_USE_ITEM, property: BGF.uri('modulates').value, name: 'Acts on the target as',
                possibleValues: uses, value: uses.find(o => o.value === signalUseValue(use))
            } as ItemDetails)
        }
        if ('modulates' in use) {
            const powers = [{ name: 'Multiplied by the signal (exponent 1)', value: '1' },
                            { name: 'Divided by the signal (exponent -1)', value: '-1' }]
            group.items.push({
                itemId: BG_SIGNAL_EXPONENT_ITEM, property: BGF.uri('modulationExponent').value, name: 'Scaled',
                possibleValues: powers, value: powers[use.exponent === -1 ? 1 : 0]
            } as ItemDetails)
        }
    }

    // Stores a change to a connection's items, and reloads them (a kind's change shows or hides its signal items)
    #updateBondItems(connection: CellDLConnection, itemId: string, value: ValueChange,
                     componentProperties: PropertyGroup[]): string {
        let errorMsg = ''
        const newValue = String(value.newValue)
        if (itemId === BG_BOND_KIND_ITEM) {
            errorMsg = this.setBondKind(connection, newValue === SIGNAL_BOND)
        } else if (itemId === BG_SIGNAL_VARIABLE_ITEM) {
            this.setSignalVariable(connection, newValue === DEFAULT_SIGNAL_VARIABLE ? undefined : newValue)
        } else if (itemId === BG_SIGNAL_USE_ITEM) {
            const old = this.signalUse(connection)
            this.#setSignalUse(connection, parseSignalUse(newValue, 'modulates' in old ? old.exponent : 1))
        } else if (itemId === BG_SIGNAL_EXPONENT_ITEM) {
            const use = this.signalUse(connection)
            if ('modulates' in use) {
                this.#setSignalUse(connection, { modulates: use.modulates, exponent: Number(newValue) })
            }
        }
        if (errorMsg) {
            alert.error(errorMsg)
        }
        const group = componentProperties.find(g => g.groupId === BG_PROPERTY_GROUP_ID.SignalBond)
        if (group) {
            this.#loadBondItems(connection, group)
        }
        return errorMsg
    }

    // Whether an element can be a module's port (bgf:portType): a flow or potential source, or a signal port block
    #hasPortType(pluginData: PluginData): boolean {
        const types = [pluginData.baseComponent?.type, pluginData.elementTemplate?.type]
        return ['FlowSource', 'PotentialSource', 'SignalInputPort', 'SignalOutputPort']
                   .some(name => types.includes(BGF.uri(name).value))
    }

    #loadElementProperties(celldlObject: CellDLObject, componentGroup: PropertyGroup, groupTemplate: IndexedPropertyGroup) {
        const pluginData = <PluginData>celldlObject.pluginData(this.id)
        groupTemplate.items.forEach((itemDetails: ItemDetails) => {
            const items: ItemDetails[] = []
            if (itemDetails.itemId === BG_ELEMENT_TYPE_ITEM) {
                const discreteItem = this.#getElementTypeItem(celldlObject, itemDetails, pluginData)
                items.push(discreteItem)
            } else if (itemDetails.itemId === BG_ELEMENT_PORT_TYPE_ITEM) {
                if (this.#hasPortType(pluginData)) {
                    const item = getItemProperty(celldlObject, itemDetails)
                    if (item) {
                        items.push(item)
                    }
                }
            } else if ((itemDetails.itemId === BG_ELEMENT_SPECIES_ITEM ||
                        itemDetails.itemId === BG_ELEMENT_LOCATION_ITEM) && pluginData.baseComponent?.isSignalBlock) {
                // a signal block has no species or location
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
                const variable = pluginData.elementTemplate?.value
                const free = !!variable && hasFreeUnits(variable)
                const item = getItemProperty(celldlObject, free ? { ...itemDetails, numeric: false } : itemDetails)
                if (item) {
                    items.push(item)
                    item.optional = false
                    if (pluginData.baseComponent.type === this.#transformNodeType) {
                        item.name = TRANSFORM_NODE_PROMPT
                    } else if (free) {
                        item.name = `${this.#valueName(pluginData.elementTemplate)} (${freeUnitsLabel(variable.unitsOf)})`
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
                        : VARIABLE_VALUE
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
                        : VARIABLE_VALUE
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
                if (item.numeric === false) {       // shown with its units, which it has no fixed ones
                    item.value = values.get(varName)!
                } else {
                    item.value = valueUnits[0]
                    item.units = valueUnits[1]
                }
                item.stored = true
            } else {
                item.stored = false
            }
        })
    }

    /** A template's default for a parameter or variable: its `TEMPLATE_PARAMETER_DEFAULTS` value, else 1. */
    #defaultValue(elementTemplate: ElementTemplate, varName: string): number {
        for (const [type, defaults] of TEMPLATE_PARAMETER_DEFAULTS) {
            if (varName in defaults && this.#subclassesOf(type).has(elementTemplate.type)) {
                return defaults[varName]!
            }
        }
        return DEFAULT_PARAMETER_VALUE
    }

    /** Stores its template's default for each parameter or variable shown with an unstored default. */
    #storeDefaultParameters(celldlObject: CellDLObject, group: PropertyGroup, elementTemplate: ElementTemplate) {
        for (const item of group.items) {
            if (item.stored === false) {
                const value = String(this.#defaultValue(elementTemplate, item.itemId.split('/')[1]!))
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
            const elementTemplate = (<PluginData>celldlObject.pluginData(this.id)).elementTemplate
            const free = !!variable && hasFreeUnits(variable)
            const name = variable ? `${this.#valueName(elementTemplate)} (${free ? freeUnitsLabel(variable.unitsOf)
                                                                              : this.#units(variable.units)})`
                                  : itemDefn.name
            let item = group.items[0]
            if (item) {
                if (variable) {
                    item.name = name
                    item.optional = false
                } else {
                    item.optional = false
                    item.value = 0
                }
            } else if (variable) {
                item = Object.assign({}, itemDefn, {
                    name,
                    optional: false,
                    value: free ? `${itemDefn.defaultValue} 1` : itemDefn.defaultValue,
                    numeric: !free
                })
                group.items.push(item)
            }
            if (item) {
                const newValue = String(item.value).trim()
                if (newValue && elementTemplate?.value) {
                    const objectUri = celldlObject.uri.toString()
                    const stored = this.#valueText(newValue, elementTemplate.value)
                    if (stored) {
                        celldlObject.rdfStore.update(`${SPARQL_PREFIXES}
                            PREFIX : <${this.#currentDocumentUri}#>

                            INSERT DATA {
                               ${objectUri} bgf:hasValue "${stored}"^^cdt:ucum .
                            }
                        `)
                    }
                }
            }
        }
    }

    // A value as stored, "<number> <units>": a variable with fixed units keeps `storedUnits` or takes its own, one
    // without takes the units typed with it (./signals.ts); undefined when the text isn't such a value
    #valueText(text: string, variable: Variable, storedUnits?: string): string|undefined {
        if (hasFreeUnits(variable)) {
            return valueWithUnits(text, storedUnits)
        }
        const number = text.trim()
        return number ? `${number} ${storedUnits ?? this.#units(variable.units)}` : undefined
    }

    // What an element's value is called: a constant for a signal block with no equation (an input port)
    #valueName(elementTemplate?: ElementTemplate): string {
        return (elementTemplate?.baseComponent.isSignalBlock && !elementTemplate.relation?.includes('<diff'))
             ? 'Value' : 'Initial value'
    }

    #setVariableItems(variables: IdVariableMap, group: PropertyGroup, reset: boolean=false) {
        if (reset) {
            group.items.length = 0
        }
        if (group.items.length === 0) {
            const property = (group.groupId === BG_PROPERTY_GROUP_ID.ElementParameters)
                            ? BGF.uri('parameterValue').value
                            : BGF.uri('variableValue').value
            for (const variable of variables.values()) {
                if (hasFreeUnits(variable)) {
                    group.items.push({
                        itemId: `${group.groupId}/${variable.name}`,
                        property: property,
                        name: `${variable.name} (${freeUnitsLabel(variable.unitsOf)})`,
                        defaultValue: '1 1',
                        value: '1 1',
                        numeric: false
                    })
                    continue
                }
                group.items.push({
                    itemId: `${group.groupId}/${variable.name}`,
                    property: property,
                    name: variable.name,
                    units: this.#units(variable.units),
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
            if (itemGroupId === BG_PROPERTY_GROUP_ID.SignalBond) {
                return celldlObject.isConnection
                     ? this.#updateBondItems(<CellDLConnection>celldlObject, itemId, value, componentProperties)
                     : ''
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
                    if (groupTemplate.groupId === BG_PROPERTY_GROUP_ID.SignalBond) {
                        continue
                    }
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
                            this.#storeDefaultParameters(celldlObject, componentGroup, elementTemplate)
                        }
                    }
                }
            }
        }
        return ''
    }

    //==================================

    componentStyling(celldlObject: CellDLObject): Styling {
        const pluginData = (<PluginData>celldlObject.pluginData(this.id))
        if (!celldlObject.isConnection && pluginData.fillString !== undefined) {
            return { fillStyle: pluginData.fillString }
        }
        return {}
    }

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
                    } else if (itemId === BG_ELEMENT_PORT_TYPE_ITEM) {
                        updateItemProperty(item.property, value, celldlObject)
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
        // An edit keeps the value's units
        const storedUnits = this.#storedUnits(objectUri)

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
        const variable = elementTemplate?.value
        const stored = (newValue && variable) ? this.#valueText(newValue, variable, storedUnits) : undefined
        if (newValue && variable && !stored) {
            alert.error(`'${newValue}' is not a number with units, such as 12 kPa`)
        }
        if (stored) {
            celldlObject.rdfStore.update(`${SPARQL_PREFIXES}
                PREFIX : <${this.#currentDocumentUri}#>

                INSERT DATA {
                   ${objectUri} bgf:hasValue "${stored}"^^cdt:ucum .
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
                        : VARIABLE_VALUE
        // An edit keeps the value's units
        const storedUnits = this.#storedUnits(objectUri, { predicate, varName })
        const variable = (groupId === BG_PROPERTY_GROUP_ID.ElementParameters)
                       ? elementTemplate.parameters.get(varName)
                       : elementTemplate.variables.get(varName)
        const stored = variable ? this.#valueText(String(value.newValue), variable, storedUnits) : undefined
        if (variable && !stored) {
            alert.error(`'${value.newValue}' is not a number with units, such as 12 kPa`)
            return
        }
        const hasNode = celldlObject.rdfStore.query(`${SPARQL_PREFIXES}
            PREFIX : <${this.#currentDocumentUri}#>
            SELECT ?pv WHERE { ${objectUri} ${predicate} ?pv . ?pv bgf:varName "${varName}" }`).length > 0
        if (!variable || !stored) {
            celldlObject.rdfStore.update(`${SPARQL_PREFIXES}
                PREFIX : <${this.#currentDocumentUri}#>

                DELETE WHERE {
                    ${objectUri} ${predicate} ?pv .
                    ?pv bgf:varName "${varName}" ;
                        bgf:hasValue ?value .
                }`)
            return
        }
        if (hasNode) {
            // its node keeps its other properties, e.g. a bgf:hasSymbol naming the parameter
            celldlObject.rdfStore.update(`${SPARQL_PREFIXES}
                PREFIX : <${this.#currentDocumentUri}#>
                DELETE { ?pv bgf:hasValue ?value }
                WHERE { ${objectUri} ${predicate} ?pv . ?pv bgf:varName "${varName}" ; bgf:hasValue ?value }`)
            celldlObject.rdfStore.update(`${SPARQL_PREFIXES}
                PREFIX : <${this.#currentDocumentUri}#>
                INSERT { ?pv bgf:hasValue "${stored}"^^cdt:ucum }
                WHERE { ${objectUri} ${predicate} ?pv . ?pv bgf:varName "${varName}" }`)
            return
        }
        celldlObject.rdfStore.update(`${SPARQL_PREFIXES}
            PREFIX : <${this.#currentDocumentUri}#>

            INSERT DATA {
                ${objectUri} ${predicate} _:pv .
                _:pv bgf:varName "${varName}" ;
                     bgf:hasValue "${stored}"^^cdt:ucum .
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
                                     pluginData.elementTemplate?.defaultStyle ?? baseComponent.style,
                                     pluginData.fillString, pluginData.elementTemplate?.lawLabel)
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
            valueUnits: elementTemplate?.value ? this.#units(elementTemplate.value.units) : undefined
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

    // A signal bond is dashed, with the closed arrowhead at its target
    styleRules(): string {
        return '.celldl-Connection.bondgraph.arrow:not(.signal) { marker-end:url(#connection-end-arrow-bondgraph) }'
             + ` .celldl-Connection.bondgraph.${SIGNAL_BOND_CLASS} { stroke-dasharray: 6 4 }`
             + ` .celldl-Connection.bondgraph.${SIGNAL_BOND_CLASS}.arrow { marker-end:url(#connection-end-arrow-bondgraph) }`
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
        if (baseComponent.isBondElement || baseComponent.isSignalBlock) {
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
        if (this.#query(`SELECT ?block WHERE { ?block rdfs:subClassOf bgf:SignalBlock }`).length) {
            elements.add(BGF.uri('SignalBlock').value)
        }
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
        // A signal block is no bond element or junction: it has no power ports
        const signalBlockType = BGF.uri('SignalBlock').value
        for (const componentTemplate of this.#componentTemplates.values()) {
            if (componentTemplate.type === signalBlockType) {
                const component = new BGBaseComponent(componentTemplate, componentTemplate.name, signalBlockType)
                this.#baseComponents.set(signalBlockType, component)
                componentTemplate.component = component
            }
        }
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
                    signalInputs: []
                }
                this.#elementTemplates.set(elementTemplate.type, elementTemplate)
                this.#baseComponentToElementTemplates.get(component.type)!.push(elementTemplate)
                continue
            }
            this.#query(elementTemplatesQuery(base)).forEach((r: Map<string, $rdf.Term>) => {
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
                    name: label ? label.value : nameFromType(element.value),
                    parameters: new Map(),
                    variables: new Map(),
                    defaultStyle: templateStyle(component.style, styleOverrides(r)),
                    lawLabel: r.get('lawLabel')?.value,
                    symbol: symbol ? symbol.value : component.symbol,
                    baseComponent: component,
                    relation: r.get('relation')?.value,
                    signalInputs: []
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

    // Only reads BG-RDF's declared ports, e.g. a chemical reaction's f (inward) and r (outward)
    #loadTemplatePorts() {
        this.#query(`
            SELECT ?element ?portId ?direction WHERE {
                ?element a bgf:ElementTemplate ;
                    bgf:hasPort ?port .
                ?port bgf:portId ?portId ;
                    bgf:direction ?direction .
            }`
        ).forEach((r: Map<string, $rdf.Term>) => {
            const template = this.#elementTemplates.get(r.get('element')!.value)
            if (template) {
                template.ports ??= { inward: 0, outward: 0 }
                const direction = r.get('direction')!.value
                if (direction === BGF.uri('InwardPort').value) {
                    template.ports.inward += 1
                } else if (direction === BGF.uri('OutwardPort').value) {
                    template.ports.outward += 1
                }
            }
        })
    }

    #saveParametersAndStates(r: Map<string, $rdf.Term>) {
        const element = r.get('element')!
        const template = this.#elementTemplates.get(element.value)
        if (!template) return ;
        if (r.has('parameterName')) {
            const name = r.get('parameterName')!.value
            template.parameters.set(name, {
                name: name,
                units: r.get('parameterUnits')?.value ?? '',
                unitsOf: r.get('parameterUnitsOf')?.value
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

    // Templates' signal inputs and a signal block's output, with their units: fixed, another variable's, or none.
    // A block whose relation is an ODE in its output, or empty (an input port), has a value: the output's initial
    // or constant value.
    #loadSignalVariables() {
        const variable = (r: Map<string, $rdf.Term>): Variable => ({
            name: r.get('name')!.value,
            units: r.get('units')?.value ?? '',
            unitsOf: r.get('unitsOf')?.value
        })
        for (const [predicate, input] of [['bgf:hasSignalInput', true], ['bgf:hasSignalOutput', false]] as const) {
            this.#query(`
                SELECT DISTINCT ?element ?name ?units ?unitsOf WHERE {
                    ?element rdfs:subClassOf* ?template .
                    ?template ${predicate} ?variable .
                    ?variable bgf:varName ?name .
                    OPTIONAL { ?variable bgf:hasUnits ?units }
                    OPTIONAL { ?variable bgf:unitsOf ?unitsOf }
                } ORDER BY ?element ?name`
            ).forEach((r: Map<string, $rdf.Term>) => {
                const template = this.#elementTemplates.get(r.get('element')!.value)
                if (!template) {
                    return
                } else if (!input) {
                    template.signalOutput = variable(r)
                } else if (!template.signalInputs.some(v => v.name === r.get('name')!.value)) {
                    template.signalInputs.push(variable(r))
                }
            })
        }
        for (const template of this.#elementTemplates.values()) {
            const output = template.signalOutput
            if (output && template.baseComponent.isSignalBlock) {
                const relation = (template.relation ?? '').replace(/\s+/g, '')
                const hasEquation = relation.includes('<apply>')
                if (!hasEquation || relation.includes(`<diff/><bvar><ci>t</ci></bvar><ci>${output.name}</ci>`)) {
                    template.value = output
                    template.units = output.units
                }
            }
        }
    }

    #loadTemplateParameters() {
        // Find parameters and variables for Element templates
        this.#query(`
            SELECT ?element ?parameterName ?parameterUnits ?parameterUnitsOf
                            ?variableName ?variableUnits
            WHERE {
                ?element a bgf:ElementTemplate .
                {
                    ?element bgf:hasParameter ?parameter .
                    ?parameter bgf:varName ?parameterName .
                    OPTIONAL { ?parameter bgf:hasUnits ?parameterUnits }
                    OPTIONAL { ?parameter bgf:unitsOf ?parameterUnitsOf }
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
            SELECT ?element ?parameterName ?parameterUnits ?parameterUnitsOf
                            ?variableName ?variableUnits
            WHERE {
                ?element a bgf:CompositeTemplate ;
                    rdfs:subClassOf ?base .
                ?base a bgf:ElementTemplate .
                {
                    ?base bgf:hasParameter ?parameter .
                    ?parameter bgf:varName ?parameterName .
                    OPTIONAL { ?parameter bgf:hasUnits ?parameterUnits }
                    OPTIONAL { ?parameter bgf:unitsOf ?parameterUnitsOf }
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
