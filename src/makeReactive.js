import { Reaction, extras, isObservable } from 'mobx';
import { Component } from 'preact';
import EventEmitter from './EventEmitter';
import { throwError } from './utils/shared';

/**
 * Dev tools support
 */
let isDevtoolsEnabled = false;

export const componentByNodeRegistery = new WeakMap();
export const renderReporter = new EventEmitter();

function reportRendering(component) {
	const node = component._vNode.dom;
	if (node && componentByNodeRegistery) {
		componentByNodeRegistery.set(node, component);
	}

	renderReporter.emit({
		event: 'render',
		renderTime: component.__$mobRenderEnd - component.__$mobRenderStart,
		totalTime: Date.now() - component.__$mobRenderStart,
		component,
		node
	});
}

export function trackComponents() {
	if (typeof WeakMap === 'undefined') {
		throwError('[inferno-mobx] tracking components is not supported in this browser.');
	}
	if (!isDevtoolsEnabled) {
		isDevtoolsEnabled = true;
	}
}

export default function makeReactive(componentClass) {

	const target = componentClass.prototype || componentClass;
	const baseDidMount = target.componentDidMount;
	const baseWillMount = target.componentWillMount;
	const baseUnmount = target.componentWillUnmount;

	target.componentWillMount = function() {

		// Call original
		baseWillMount && baseWillMount.call(this);

		let reaction;
		let isRenderingPending = false;

		const initialName = this.displayName || this.name || (this.constructor && (this.constructor.displayName || this.constructor.name)) || '<component>';
		const baseRender = this.render.bind(this);

		const initialRender = (nextProps, nextState, nextContext) => {
			reaction = new Reaction(`${initialName}.render()`, () => {
				if (!isRenderingPending) {
					isRenderingPending = true;
					if (this.__$mobxIsUnmounted !== true) {
						let hasError = true;
						try {
							Component.prototype.forceUpdate.call(this);
							hasError = false;
						} finally {
							if (hasError) {
								reaction.dispose();
							}
						}
					}
				}
			});
			reactiveRender.$mobx = reaction;
			this.render = reactiveRender;
			return reactiveRender(nextProps, nextState, nextContext);
		};

		const reactiveRender = (nextProps, nextState, nextContext) => {
			isRenderingPending = false;
			let rendering = undefined;
			reaction.track(() => {
				if (isDevtoolsEnabled) {
					this.__$mobRenderStart = Date.now();
				}
				rendering = extras.allowStateChanges(false, baseRender.bind(this, nextProps, nextState, nextContext));
				if (isDevtoolsEnabled) {
					this.__$mobRenderEnd = Date.now();
				}
			});
			return rendering;
		};

		this.render = initialRender;
	};

	target.componentDidMount = function() {
		isDevtoolsEnabled && reportRendering(this);

		// Call original
		baseDidMount && baseDidMount.call(this);
	};

	target.componentWillUnmount = function() {
		// Call original
		baseUnmount && baseUnmount.call(this);

		// Dispose observables
		this.render.$mobx && this.render.$mobx.dispose();
		this.__$mobxIsUnmounted = true;

		if (isDevtoolsEnabled) {
			const node = this._vNode.dom;
			if (node && componentByNodeRegistery) {
				componentByNodeRegistery.delete(node);
			}
			renderReporter.emit({
				event: 'destroy',
				component: this,
				node
			});
		}
	};

	target.shouldComponentUpdate = function(nextProps, nextState) {
		// Update on any state changes (as is the default)
		if (this.state !== nextState) {
			return true;
		}

		// Update if props are shallowly not equal, inspired by PureRenderMixin
		const keys = Object.keys(this.props);
		if (keys.length !== Object.keys(nextProps).length) {
			return true;
		}

		for (let i = keys.length - 1; i >= 0; i--) {
			let key = keys[i];
			const newValue = nextProps[key];
			if (newValue !== this.props[key]) {
				return true;
			} else if (newValue && typeof newValue === 'object' && !isObservable(newValue)) {
				// If the newValue is still the same object, but that object is not observable,
				// fallback to the default behavior: update, because the object *might* have changed.
				return true;
			}
		}
		return true;
	};

	return componentClass;
}
