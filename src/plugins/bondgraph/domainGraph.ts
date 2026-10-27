/******************************************************************************

CellDL Editor

Copyright (c) 2022 - 2026 David Brooks

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

import Graph from 'graphology'

//==============================================================================

import { BGF, SPARQL_PREFIXES, type MetadataStore } from '@celldl/metadata'

import * as $rdf from '@celldl/rdf'

//==============================================================================

const BOND_ELEMENT_QUERY = `
    SELECT ?model ?element ?domain
    WHERE {
        ?model
            a bgf:BondgraphModel ;
            bgf:hasBondElement ?element .
        ?element a ?bondElement .
        ?bondElement rdfs:subClassOf* bgf:BondElement .
        OPTIONAL {
            ?bondElement rdfs:subClassOf* ?base .
            ?base bgf:hasDomain ?domain
        }
    } ORDER BY ?model
`

const JUNCTION_STRUCTURE_QUERY = `
    SELECT ?model ?junction ?junctionType
    WHERE {
        ?model
            a bgf:BondgraphModel ;
            bgf:hasJunctionStructure ?junction .
        ?junction a ?junctionType .
        ?junctionType rdfs:subClassOf* bgf:JunctionStructure .
    }
`

const UNCONNECTED_PORT_QUERY = `
    SELECT ?port
    WHERE {
        ?port a celldl:UnconnectedPort .
    }
`

const POWER_BOND_QUERY = `
    SELECT ?bond ?source ?target
    WHERE {
        ?bond
            a celldl:Connection ;
            bgf:hasSource ?source ;
            bgf:hasTarget ?target .
        FILTER NOT EXISTS { ?bond a bgf:SignalBond }
    }
`

//==============================================================================

function domainMismatch(where: string, node0: string, node1: string) {
    console.error(`${where}: domains don't match for ${$rdf.getFragment(node0)} and ${$rdf.getFragment(node1)}`)
}

//==============================================================================

export class DomainGraph {
    #elementNodesByDomain: Map<string, Set<string>> = new Map()
    #graph: Graph = new Graph()
    #transformNodes: Set<string> = new Set()

    constructor(rdfStore: MetadataStore|undefined, modelUri: string|undefined=undefined) {
        if (!rdfStore) {
            return
        }
        // Add all elements without their domains
        rdfStore
            .query(`${SPARQL_PREFIXES}${BOND_ELEMENT_QUERY}`, true)
            .forEach((r: Map<string, $rdf.Term>) => {
                const model = r.get('model')!.value
                if (!modelUri) {
                    modelUri = model
                }
                if (model === modelUri) {
                    const element = r.get('element')!.value
                    if (!this.#graph.hasNode(element)) {
                        this.#graph.addNode(element)
                    }
                    const domain = r.get('domain')?.value
                    if (domain) {
                        this.#addDomain(element, domain)
                    }
                }
            }
        )
        // Add all junctions and note TransformNodes
        rdfStore
            .query(`${SPARQL_PREFIXES}${JUNCTION_STRUCTURE_QUERY}`, true)
            .forEach((r: Map<string, $rdf.Term>) => {
                const model = r.get('model')!.value
                if (model === modelUri) {
                    const junction = r.get('junction')!.value
                    if (!this.#graph.hasNode(junction)) {       // i.e. not part of a composite node
                        this.#graph.addNode(junction)
                        if (r.get('junctionType')!.value === BGF.uri('TransformNode').value) {
                            this.#transformNodes.add(junction)
                        }
                    }
                }
            }
        )
        // Add any unconnected ports
        rdfStore
            .query(`${SPARQL_PREFIXES}${UNCONNECTED_PORT_QUERY}`)
            .forEach((r: Map<string, $rdf.Term>) => {
                const port = r.get('port')!.value
                this.#graph.addNode(port)
            }
        )
        // Add all bonds
        rdfStore
            .query(`${SPARQL_PREFIXES}${POWER_BOND_QUERY}`)
            .forEach((r: Map<string, $rdf.Term>) => {
                this.#graph.addEdgeWithKey(r.get('bond')!.value, r.get('source')!.value, r.get('target')!.value)
            }
        )
        // Assign domains to elements
        for (const [domain, elements] of this.#elementNodesByDomain.entries()) {
            for (const element of elements.values()) {
                this.#setDomains(element, domain)
            }
        }
    }

    //==========================================================================

    addNode(nodeUri: string, domain: string|undefined=undefined, transformNode: boolean=false) {
        if (!this.#graph.hasNode(nodeUri)) {
            this.#graph.addNode(nodeUri)
        }
        if (domain) {
            this.#graph.setNodeAttribute(nodeUri, 'domain', domain)
        }
        this.#addDomain(nodeUri, domain)
        if (transformNode) {
            this.#transformNodes.add(nodeUri)
        }
    }

    deleteNode(nodeUri: string) {
        if (!this.#graph.hasNode(nodeUri)) {
            return      // e.g. a signal block, which has no physical domain
        }
        const domain = this.#graph.getNodeAttribute(nodeUri, 'domain')
        this.#deleteDomain(nodeUri, domain)
        this.#graph.dropNode(nodeUri)
        this.#transformNodes.delete(nodeUri)
    }

    //==========================================================================

    getDomain(uri: string): string|undefined {
        if (this.#graph.hasNode(uri)) {
            return this.#graph.getNodeAttribute(uri, 'domain')
        } else if (this.#graph.hasEdge(uri)) {
            return this.#graph.getEdgeAttribute(uri, 'domain')
        }
    }

    setDomain(uri: string, domain: string|undefined) {
        if (this.#graph.hasNode(uri)) {
            const elementDomain = this.#graph.getNodeAttribute(uri, 'domain')
            this.#deleteDomain(uri, elementDomain)  // delete needs to be before clear...
            this.#clearDomains(uri, elementDomain)
            if (domain) {
                this.#setDomains(uri, domain)
                this.#addDomain(uri, domain)
            }
        }
    }

    //==========================================================================

    addEdge(edgeUri: string, edgeNodeUris: [string, string]) {
        if (this.#graph.hasNode(edgeNodeUris[0]) && this.#graph.hasNode(edgeNodeUris[1])) {
            const domainNode0 = this.#graph.getNodeAttribute(edgeNodeUris[0], 'domain')
            const domainNode1 = this.#graph.getNodeAttribute(edgeNodeUris[1], 'domain')
            let domain: string|undefined
            if (domainNode0) {
                if (!domainNode1) {
                    if (!this.#transformNodes.has(edgeNodeUris[1])) {
                        // Propogate `domainNode0` via `edgeNodeUris[1]`
                        this.#setDomains(edgeNodeUris[1], domainNode0)
                    }
                    domain = domainNode0
                } else if (domainNode0 !== domainNode1) {
                    domainMismatch('addEdge', edgeNodeUris[0], edgeNodeUris[1])
                } else {
                    domain = domainNode0
                }
            } else if (domainNode1) {
                if (!this.#transformNodes.has(edgeNodeUris[0])) {
                    // Propogate `domainNode1` via `edgeNodeUris[0]`
                    this.#setDomains(edgeNodeUris[0], domainNode1)
                }
                domain = domainNode1
            }
            const edge = this.#graph.addEdgeWithKey(edgeUri, edgeNodeUris[0], edgeNodeUris[1])
            if (domain) {
                this.#graph.setEdgeAttribute(edge, 'domain', domain)
            }
        }
    }

    hasEdge(edgeNodeUris: [string, string]): boolean {
        return this.#graph.hasEdge(edgeNodeUris[0], edgeNodeUris[1])
    }

    deleteEdge(edgeNodeUris: [string, string]) {
        this.#graph.dropEdge(edgeNodeUris[0], edgeNodeUris[1])
        const domainNode0 = this.#graph.getNodeAttribute(edgeNodeUris[0], 'domain')
        const domainNode1 = this.#graph.getNodeAttribute(edgeNodeUris[1], 'domain')
        if (domainNode0 && domainNode1 && domainNode0 !== domainNode1) {
            domainMismatch('deleteEdge', edgeNodeUris[0], edgeNodeUris[1])
        }
        if (!this.#transformNodes.has(edgeNodeUris[0])
         && !this.#transformNodes.has(edgeNodeUris[1])) {
            this.#clearDomains(edgeNodeUris[0], domainNode0)
            this.#clearDomains(edgeNodeUris[1], domainNode1)
        }
    }

    //==========================================================================

    #addDomain(elementUri: string, domain: string|undefined) {
        if (domain) {
            if (!this.#elementNodesByDomain.has(domain)) {
                this.#elementNodesByDomain.set(domain, new Set())
            }
            this.#elementNodesByDomain.get(domain)!.add(elementUri)
        }
    }

    #deleteDomain(elementUri: string, domain: string|undefined) {
        if (domain) {
            if (this.#elementNodesByDomain.has(domain)) {
                this.#elementNodesByDomain.get(domain)!.delete(elementUri)
            }
        }
    }

    #clearDomains(nodeUri: string, currentDomain: string|undefined) {
        if (!currentDomain) {
            return
        }
        const nodeGraph = this.#graph
        const domainNodes = this.#elementNodesByDomain.get(currentDomain)
        if (!domainNodes || domainNodes.has(nodeUri)) {
            return
        }
        // Find the set of nodes that are connected to us.
        // If any of them are element nodes then do nothing
        // otherwise remove the domain from each node in the set.
        const seenNodes: Set<string> = new Set()
        const clearNodes: Set<string> = new Set()
        const clearEdges: Set<[string, string]> = new Set()
        const transformNodes = this.#transformNodes

        function hasDomainNodes(startNode: string): boolean {
            if (!seenNodes.has(startNode)) {
                seenNodes.add(startNode)
                for (const neighbour of nodeGraph.neighbors(startNode)) {
                    if (nodeGraph.hasEdge(startNode, neighbour)) {
                        clearEdges.add([startNode, neighbour])
                    } else {
                        clearEdges.add([neighbour, startNode])
                    }
                    if (!transformNodes.has(neighbour)) {
                        const neighbourDomain = nodeGraph.getNodeAttribute(neighbour, 'domain')
                        if (!neighbourDomain) {
                            return false
                        } else if (neighbourDomain !== currentDomain) {
                            domainMismatch('clearDomains', startNode, neighbour)
                        }
                        // ?? what if neighbour is a JS ??
                        if (domainNodes!.has(neighbour) || hasDomainNodes(neighbour)) {
                            return true
                        }
                    }
                }
                clearNodes.add(startNode)
            }
            return false
        }

        // don't clear if there's still a connected element with a domain
        if (hasDomainNodes(nodeUri)) {
            return
        }
        // ok to remove domain from all connected nodes
        for (const node of clearNodes.values()) {
            nodeGraph.removeNodeAttribute(node, 'domain')
        }
        // ok to remove domain from all edges
        for (const edge of clearEdges.values()) {
            nodeGraph.removeEdgeAttribute(edge[0], edge[1], 'domain')
        }
    }

    #setDomains(nodeUri: string, domain: string) {
        const nodeGraph = this.#graph
        const seenNodes: Set<string> = new Set()
        const transformNodes = this.#transformNodes

        function broadcastDomain(startNode: string, domain: string) {
            if (!seenNodes.has(startNode)) {
                seenNodes.add(startNode)
                if (domain) {
                    nodeGraph.setNodeAttribute(startNode, 'domain', domain)
                    for (const neighbour of nodeGraph.neighbors(startNode)) {
                        if (nodeGraph.hasEdge(startNode, neighbour)) {
                            nodeGraph.setEdgeAttribute(startNode, neighbour, 'domain', domain)
                        } else {
                            nodeGraph.setEdgeAttribute(neighbour, startNode, 'domain', domain)
                        }
                        if (!transformNodes.has(neighbour)) {
                            const neighbourDomain = nodeGraph.getNodeAttribute(neighbour, 'domain')
                            if (!neighbourDomain) {
                                broadcastDomain(neighbour, domain)
                            } else if (neighbourDomain !== domain) {
                                domainMismatch('setDomains', startNode, neighbour)
                            }
                        }
                    }
                }
            }
        }
        broadcastDomain(nodeUri, domain)
    }
}

//==============================================================================
//==============================================================================
