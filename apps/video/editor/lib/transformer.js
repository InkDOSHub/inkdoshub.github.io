/* eslint-disable */
 
/*!
 * @pixi-essentials/transformer - v3.0.2
 * Compiled Mon, 03 Jul 2023 13:18:15 UTC
 *
 * @pixi-essentials/transformer is licensed under the MIT License.
 * http://www.opensource.org/licenses/mit-license
 * 
 * Copyright 2019-2020, Shukant K. Pal <shukantpal@outlook.com>, All Rights Reserved
 */
this.PIXI = this.PIXI || {};
(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports, require('@pixi/display'), require('@pixi/math'), require('@pixi-essentials/bounds'), require('@pixi-essentials/object-pool'), require('@pixi/graphics')) :
    typeof define === 'function' && define.amd ? define(['exports', '@pixi/display', '@pixi/math', '@pixi-essentials/bounds', '@pixi-essentials/object-pool', '@pixi/graphics'], factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global._pixi_essentials_transformer = {}, global.PIXI, global.PIXI, global.PIXI, global.PIXI, global.PIXI));
}(this, (function (exports, display, math, bounds, objectPool, graphics) { 'use strict';

    /** @see TransformerHandle#style */


















    /**
     * The default transformer handle style.
     *
     * @ignore
     */
    const DEFAULT_HANDLE_STYLE = {
        color: 0xffffff,
        outlineColor: 0x000000,
        outlineThickness: 1,
        radius: 8,
        shape: 'tooth',
    };

    const Graphics_ = graphics.Graphics ;

    /**
     * The transfomer handle base implementation.
     *
     * @extends PIXI.Graphics
     */
    class TransformerHandle extends Graphics_
    {
        
        

        
        
        

        
        
        
        

        /**
         * @param {Transformer} transformer
         * @param {string} handle - the type of handle being drawn
         * @param {object} styleOpts - styling options passed by the user
         * @param {function} handler - handler for drag events, it receives the pointer position; used by {@code onDrag}.
         * @param {function} commit - handler for drag-end events.
         * @param {string}[cursor='move'] - a custom cursor to be applied on this handle
         */
        constructor(
              transformer,
            handle,
            styleOpts = {},
            handler,
            commit,
            cursor)
        {
            super();this.transformer = transformer;;

            const style = Object.assign({}, DEFAULT_HANDLE_STYLE, styleOpts);

            this._handle = handle;
            this._style = style;
            this.onHandleDelta = handler;
            this.onHandleCommit = commit;

            /**
             * This flags whether this handle should be redrawn in the next frame due to style changes.
             */
            this._dirty = true;

            // Pointer events
            this.interactive = true;
            this.cursor = cursor || 'move';
            this._pointerDown = false;
            this._pointerDragging = false;
            this._pointerPosition = new math.Point();
            this._pointerMoveTarget = null;

            this.onPointerDown = this.onPointerDown.bind(this);
            this.onPointerMove = this.onPointerMove.bind(this);
            this.onPointerUp = this.onPointerUp.bind(this);

            this.onpointerdown = this.onPointerDown;
            this.onpointermove = this.onPointerMove;
            this.onpointerup = this.onPointerUp;
            this.onpointerupoutside = this.onPointerUp;
        }

        get handle()
        {
            return this._handle;
        }
        set handle(handle)
        {
            this._handle = handle;
            this._dirty = true;
        }

        /**
         * The currently applied handle style.
         */
        get style()
        {
            return this._style;
        }
        set style(value)
        {
            this._style = Object.assign({}, DEFAULT_HANDLE_STYLE, value);
            this._dirty = true;
        }

        render(renderer)
        {
            if (this._dirty)
            {
                this.draw();

                this._dirty = false;
            }

            super.render(renderer);
        }

        /**
         * Redraws the handle's geometry. This is called on a `render` if {@code this._dirty} is true.
         */
         draw()
        {
            const handle = this._handle;
            const style = this._style;

            const radius = style.radius;

            this.clear()
                .lineStyle(style.outlineThickness, style.outlineColor)
                .beginFill(style.color);

            if (style.shape === 'square')
            {
                this.drawRect(-radius / 2, -radius / 2, radius, radius);
            }
            else if (style.shape === 'tooth')
            {
                switch (handle)
                {
                    case 'middleLeft':
                        this.drawPolygon([
                            -radius / 2, -radius / 2,
                            -radius / 2, radius / 2,
                            radius / 2, radius / 2,
                            radius * 1.1, 0,
                            radius / 2, -radius / 2,
                        ]);
                        break;
                    case 'topCenter':
                        this.drawPolygon([
                            -radius / 2, -radius / 2,
                            radius / 2, -radius / 2,
                            radius / 2, radius / 2,
                            0, radius * 1.1,
                            -radius / 2, radius / 2,
                        ]);
                        break;
                    case 'middleRight':
                        this.drawPolygon([
                            -radius / 2, radius / 2,
                            -radius * 1.1, 0,
                            -radius / 2, -radius / 2,
                            radius / 2, -radius / 2,
                            radius / 2, radius / 2,
                        ]);
                        break;
                    case 'bottomCenter':
                        this.drawPolygon([
                            0, -radius * 1.1,
                            radius / 2, -radius / 2,
                            radius / 2, radius / 2,
                            -radius / 2, radius / 2,
                            -radius / 2, -radius / 2,
                        ]);
                        break;
                    case 'rotator':
                        this.drawCircle(0, 0, radius / Math.sqrt(2));
                        break;
                    default:
                        this.drawRect(-radius / 2, -radius / 2, radius, radius);
                        break;
                }
            }
            else
            {
                this.drawCircle(0, 0, radius);
            }

            this.endFill();
        }

        /**
         * Handles the `pointerdown` event. You must call the super implementation.
         *
         * @param e
         */
         onPointerDown(e)
        {
            this._pointerDown = true;
            this._pointerDragging = false;

            e.stopPropagation();

            if (this._pointerMoveTarget)
            {
                this._pointerMoveTarget.removeEventListener('globalpointermove', this.onPointerMove);
                this._pointerMoveTarget = null;
            }

            this._pointerMoveTarget = (this.transformer.stage || this) ;
            this._pointerMoveTarget.addEventListener('globalpointermove', this.onPointerMove);
        }

        /**
         * Handles the `pointermove` event. You must call the super implementation.
         *
         * @param e
         */
         onPointerMove(e)
        {
            if (!this._pointerDown)
            {
                return;
            }

            if (this._pointerDragging)
            {
                this.onDrag(e);
            }
            else
            {
                this.onDragStart(e);
            }

            e.stopPropagation();
        }

        /**
         * Handles the `pointerup` and `pointerupoutside` events. You must call the super implementation.
         *
         * @param e
         */
         onPointerUp(e)
        {
            if (this._pointerDragging)
            {
                this.onDragEnd(e);
            }

            this._pointerDown = false;

            if (this._pointerMoveTarget)
            {
                this._pointerMoveTarget.removeEventListener('globalpointermove', this.onPointerMove);
                this._pointerMoveTarget = null;
            }
        }

        /**
         * Called on the first `pointermove` when {@code this._pointerDown} is true. You must call the super implementation.
         *
         * @param e
         */
         onDragStart(e)
        {
            this._pointerPosition.copyFrom(e.data.global);

            this._pointerDragging = true;
        }

        /**
         * Called on a `pointermove` when {@code this._pointerDown} & {@code this._pointerDragging}.
         *
         * @param e
         */
         onDrag(e)
        {
            const currentPosition = e.data.global;

            // Callback handles the rest!
            if (this.onHandleDelta)
            {
                this.onHandleDelta(currentPosition);
            }

            this._pointerPosition.copyFrom(currentPosition);
        }

        /**
         * Called on a `pointerup` or `pointerupoutside` & {@code this._pointerDragging} was true.
         *
         * @param _
         */
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
         onDragEnd(_)
        {
            this._pointerDragging = false;

            if (this.onHandleCommit)
            {
                this.onHandleCommit();
            }
        }
    }

    /**
     * Calculates the distance of (x,y) from the line through l0 and l1.
     *
     * @ignore
     */
    function distanceToLine(h, k, l0, l1)
    {
        const { x: x0, y: y0 } = l0;
        const { x: x1, y: y1 } = l1;

        if (Math.abs(x1 - x0) < 0.01)
        {
            return Math.abs(h - x0);
        }
        if (Math.abs(y1 - y0) < 0.01)
        {
            return Math.abs(k - y0);
        }

        const m = (y1 - y0) / (x1 - x0);

        // Equation of line: mx - y - (y₁ - mx₁) = 0
        // Distance to line from (h,k): |(mh - k + (y₁ - mx₁)) / √(m²+1)|

        return Math.abs(((m * h) - k + (y1 - (m * x1))) / Math.sqrt((m * m) + 1));
    }

    const pointPool = objectPool.ObjectPoolFactory.build(math.Point);
    const tempHull = [new math.Point(), new math.Point(), new math.Point(), new math.Point()];
    const tempMatrix = new math.Matrix();
    const tempPoint = new math.Point();

    /**
     * Box rotation region for the top-left corner, normalized to 1-unit tolerance
     * and positioned at the origin.
     *
     * @ignore
     * @internal
     */
    const boxRotationRegionTopLeft = [
        0, 0,
        0, 1,
        -1, 1,
        -1, -1,
        1, -1,
        1, 0,
    ];

    /**
     * Box rotation region for the top-right corner, normalized to 1-unit tolerance
     * and positioned at the origin.
     *
     * @ignore
     * @internal
     */
    const boxRotationRegionTopRight = [
        0, 0,
        -1, 0,
        -1, -1,
        1, -1,
        1, 1,
        0, 1,
    ];

    /**
     * Box rotation region for the bottom-left corner, normalized to 1-unit tolerance
     * and positioned at the origin.
     *
     * @ignore
     * @internal
     */
    const boxRotationRegionBottomLeft = [
        0, 0,
        1, 0,
        1, 1,
        -1, 1,
        -1, -1,
        0, -1,
    ];

    /**
     * Box rotation region for the bottom-right corner, normalized to 1-unit tolerance
     * and positioned at the origin.
     *
     * @ignore
     * @internal
     */
    const boxRotationRegionBottomRight = [
        0, 0,
        0, -1,
        1, -1,
        1, 1,
        -1, 1,
        -1, 0,
    ];

    /**
     * Array used to store transformed box rotation region geometries.
     *
     * @ignore
     * @internal
     */
    const boxRotationTemp = new Array(12);

    /**
     * Box rotation region geometries in one array.
     *
     * @ignore
     * @internal
     */
    const boxRotationRegions = [
        boxRotationRegionTopLeft,
        boxRotationRegionTopRight,
        boxRotationRegionBottomLeft,
        boxRotationRegionBottomRight,
    ];

    const Graphics_$1 = graphics.Graphics ;


    /**
     * The transformer's wireframe is drawn using this class.
     *
     * @ignore
     * @public
     * @extends PIXI.Graphics
     */
    class TransformerWireframe extends Graphics_$1
    {
        

        /**
         * The four scaling "edges" (or wide handles) for box-scaling. {@link TransformerWireframe#drawBoxScalingTolerance}
         * should draw into these.
         *
         * @type {PIXI.Graphics[]}
         */
        

        constructor(transformer)
        {
            super();

            this.transformer = transformer;

            this.boxScalingHandles = [
                this.addChild(new graphics.Graphics()),
                this.addChild(new graphics.Graphics()),
                this.addChild(new graphics.Graphics()),
                this.addChild(new graphics.Graphics()),
            ] ;
            this.boxScalingHandles.forEach((scalingHandle) => { scalingHandle.interactive = true; });
            this.boxScalingHandles[0].cursor = HANDLE_TO_CURSOR.topCenter;
            this.boxScalingHandles[1].cursor = HANDLE_TO_CURSOR.middleRight;
            this.boxScalingHandles[2].cursor = HANDLE_TO_CURSOR.bottomCenter;
            this.boxScalingHandles[3].cursor = HANDLE_TO_CURSOR.middleLeft;
        }

        /**
         * Detects which type of box-handle, if any, the pointer clicked on in the wireframe.
         *
         * @param groupBounds
         * @param projectionTransform
         * @param pointerPosition
         */
         hitHandleType(groupBounds, projectionTransform, pointerPosition)
        {
            const {
                boxRotationEnabled,
                boxRotationTolerance,
                boxScalingEnabled,
                boxScalingTolerance,
            } = this.transformer;
            const [
                topLeft,
                topRight,
                bottomRight,
                bottomLeft,
            ] = groupBounds.hull;

            const { x, y } = projectionTransform.applyInverse(pointerPosition, tempPoint);

            if (boxScalingEnabled)
            {
                const topProximity = distanceToLine(x, y, topLeft, topRight) * projectionTransform.d;
                const leftProximity = distanceToLine(x, y, topLeft, bottomLeft) * projectionTransform.a;
                const rightProximity = distanceToLine(x, y, topRight, bottomRight) * projectionTransform.a;
                const bottomProximity = distanceToLine(x, y, bottomLeft, bottomRight) * projectionTransform.d;
                const minProximity = Math.min(topProximity, leftProximity, rightProximity, bottomProximity);

                if (minProximity < boxScalingTolerance)
                {
                    switch (minProximity)
                    {
                        case topProximity: return 'topCenter';
                        case leftProximity: return 'middleLeft';
                        case rightProximity: return 'middleRight';
                        case bottomProximity: return 'bottomCenter';
                    }
                }
            }

            if (boxRotationEnabled && !groupBounds.contains(x, y))
            {
                const tlProximity = Math.sqrt(((topLeft.x - x) ** 2) + ((topLeft.y - y) ** 2));
                const trProximity = Math.sqrt(((topRight.x - x) ** 2) + ((topRight.y - y) ** 2));
                const blProximity = Math.sqrt(((bottomLeft.x - x) ** 2) + ((bottomLeft.y - y) ** 2));
                const brProximity = Math.sqrt(((bottomRight.x - x) ** 2) + ((bottomRight.y - y) ** 2));
                const minProximity = Math.min(tlProximity, trProximity, blProximity, brProximity);

                // The box-rotation handles are squares, that mean they extend boxRotationTolerance√2
                if (minProximity < boxRotationTolerance * 1.45)
                {
                    switch (minProximity)
                    {
                        case tlProximity: return 'boxRotateTopLeft';
                        case trProximity: return 'boxRotateTopRight';
                        case blProximity: return 'boxRotateBottomLeft';
                        case brProximity: return 'boxRotateBottomRight';
                    }
                }
            }

            return null;
        }

        /**
         * Draws the bounding box into the wireframe.
         *
         * @param bounds
         */
         drawBounds(bounds)
        {
            const hull = tempHull;

            // Bring hull into local-space
            for (let i = 0; i < 4; i++)
            {
                this.transformer.projectToLocal(bounds.hull[i], hull[i]);
            }

            // Fill polygon with ultra-low alpha to capture pointer events.
            this.drawPolygon(hull);
        }

        /**
         * Draws around edges of the bounding box to capture pointer events within
         * {@link Transformer#boxScalingTolerance}.
         *
         * @param bounds
         * @param boxScalingTolerance
         */
         drawBoxScalingTolerance(
            bounds,
            boxScalingTolerance = this.transformer.boxScalingTolerance,
        )
        {
            bounds.innerBounds.pad(-boxScalingTolerance);

            // Inner four corners
            const innerHull = pointPool.allocateArray(4);

            innerHull.forEach((innerCorner, i) =>
            {
                this.projectToLocal(bounds.hull[i], innerCorner);
            });

            // A little extra tolerance outside because of arrow cursors being longer
            bounds.innerBounds.pad(2.5 * boxScalingTolerance);

            // Outer four corners
            const outerHull = pointPool.allocateArray(4);

            outerHull.forEach((outerCorner, i) =>
            {
                this.projectToLocal(bounds.hull[i], outerCorner);
            });

            // Leave at original
            bounds.innerBounds.pad(-1.5 * this.transformer.boxScalingTolerance);

            for (let i = 0; i < 4; i++)
            {
                const innerStart = innerHull[i];
                const innerEnd = innerHull[(i + 1) % 4];
                const outerStart = outerHull[i];
                const outerEnd = outerHull[(i + 1) % 4];

                const boxScalingHandle = this.boxScalingHandles[i];

                boxScalingHandle.clear()
                    .beginFill(0xffffff, 1e-4)
                    .drawPolygon(innerStart, outerStart, outerEnd, innerEnd)
                    .endFill();
            }
        }

        /**
         * Draws square-shaped tolerance regions for capturing pointer events within {@link Transformer#boxRotationTolernace}
         * of the four corners of the group bounding box. The square are cut in the interior region of the group bounds.
         */
         drawBoxRotationTolerance()
        {
            const {
                boxRotateTopLeft: tl,
                boxRotateTopRight: tr,
                boxRotateBottomLeft: bl,
                boxRotateBottomRight: br,
            } = this.transformer.handleAnchors;

            // 2x because half of the square's width & height is inside
            const t = this.transformer.boxRotationTolerance * 2;

            // Expand box rotation regions to the given tolerance, and then rotate to align with
            // the group bounds. The position is added manually.
            const matrix = tempMatrix
                .identity()
                .scale(t, t)
                .rotate(this.transformer.getGroupBounds().rotation);

            for (let i = 0; i < 4; i++)
            {
                const region = boxRotationRegions[i];
                let position;

                switch (i)
                {
                    case 0: position = tl; break;
                    case 1: position = tr; break;
                    case 2: position = bl; break;
                    case 3: position = br; break;
                }

                for (let j = 0; j < region.length; j += 2)
                {
                    const x = region[j];
                    const y = region[j + 1];

                    tempPoint.set(x, y);
                    matrix.apply(tempPoint, tempPoint);

                    boxRotationTemp[j] = tempPoint.x + position.x;
                    boxRotationTemp[j + 1] = tempPoint.y + position.y;
                }

                this.drawPolygon(boxRotationTemp.slice());
            }
        }

        /**
         * Alias for {@link Transformer#projectToLocal}. The transform of the wireframe should equal that
         * of the transformer itself.
         *
         * @param input
         * @param output
         */
         projectToLocal(input, output)
        {
            return this.transformer.projectToLocal(input, output);
        }
    }

    const tempMatrix$1 = new math.Matrix();

    /**
     * @ignore
     * @param angle
     * @returns a horizontal skew matrix
     */
    function createHorizontalSkew(angle)
    {
        const matrix = tempMatrix$1.identity();

        matrix.c = Math.tan(angle);

        return matrix;
    }

    /**
     * @ignore
     * @param angle
     * @returns a vertical skew matrix
     */
    function createVerticalSkew(angle)
    {
        const matrix = tempMatrix$1.identity();

        matrix.b = Math.tan(angle);

        return matrix;
    }

    /**
     * Decomposes the matrix into transform, while preserving rotation & the pivot.
     *
     * @ignore
     * @param transform
     * @param matrix
     * @param rotation
     * @param pivot
     */
    function decomposeTransform(
        transform,
        matrix,
        rotation,
        pivot = transform.pivot,
    )
    {
        const a = matrix.a;
        const b = matrix.b;
        const c = matrix.c;
        const d = matrix.d;

        const skewX = -Math.atan2(-c, d);
        const skewY = Math.atan2(b, a);

        rotation = rotation !== undefined && rotation !== null ? rotation : skewY;

        // set pivot
        transform.pivot.set(pivot.x, pivot.y);

        // next set rotation, skew angles
        transform.rotation = rotation;
        transform.skew.x = rotation + skewX;
        transform.skew.y = -rotation + skewY;

        // next set scale
        transform.scale.x = Math.sqrt((a * a) + (b * b));
        transform.scale.y = Math.sqrt((c * c) + (d * d));

        // next set position
        transform.position.x = matrix.tx + ((pivot.x * matrix.a) + (pivot.y * matrix.c));
        transform.position.y = matrix.ty + ((pivot.x * matrix.b) + (pivot.y * matrix.d));

        return transform;
    }

    const tempMatrix$2 = new math.Matrix();
    const tempParentMatrix = new math.Matrix();

    /**
     * Multiplies the transformation matrix {@code transform} to the display-object's transform.
     *
     * @ignore
     * @param displayObject
     * @param transform
     * @param skipUpdate
     */
    function multiplyTransform(displayObject, transform, skipUpdate)
    {
        if (!skipUpdate)
        {
            const parent = !displayObject.parent ? displayObject.enableTempParent() : displayObject.parent;

            displayObject.updateTransform();
            displayObject.disableTempParent(parent);
        }

        const worldTransform = displayObject.worldTransform;
        const parentTransform = displayObject.parent
            ? tempParentMatrix.copyFrom(displayObject.parent.worldTransform)
            : math.Matrix.IDENTITY;

        tempMatrix$2.copyFrom(worldTransform);
        tempMatrix$2.prepend(transform);
        tempMatrix$2.prepend(parentTransform.invert());// gets new "local" transform

        decomposeTransform(displayObject.transform, tempMatrix$2);
    }

    // Preallocated objects
    const tempTransform = new math.Transform();
    const tempCorners = [new math.Point(), new math.Point(), new math.Point(), new math.Point()];
    const tempMatrix$3 = new math.Matrix();
    const tempPoint$1 = new math.Point();
    const tempBounds = new bounds.OrientedBounds();
    const tempRect = new math.Rectangle();
    const tempHull$1 = [new math.Point(), new math.Point(), new math.Point(), new math.Point()];
    const tempPointer = new math.Point();
    const emitMatrix = new math.Matrix();// Used to pass to event handlers

    // Pool for allocating an arbitrary number of points
    const pointPool$1 = objectPool.ObjectPoolFactory.build(math.Point );

    /**
     * The handles used for rotation.
     *
     * @public
     * @ignore
     */






































    /**
     * Specific cursors for each handle
     *
     * @ignore
     */
    const HANDLE_TO_CURSOR = {
        topLeft: 'nw-resize',
        topCenter: 'n-resize',
        topRight: 'ne-resize',
        middleLeft: 'w-resize',
        middleRight: 'e-resize',
        bottomLeft: 'sw-resize',
        bottomCenter: 's-resize',
        bottomRight: 'se-resize',
    };

    /**
     * An array of all {@link ScaleHandle} values.
     *
     * @internal
     * @ignore
     */
    const SCALE_HANDLES = [
        'topLeft',
        'topCenter',
        'topRight',
        'middleLeft',
        'middleCenter',
        'middleRight',
        'bottomLeft',
        'bottomCenter',
        'bottomRight',
    ];

    /**
     * This maps each scaling handle to the directions in which the x, y components are outward. A value of
     * zero means that no scaling occurs along that component's axis.
     *
     * @internal
     * @ignore
     */
    const SCALE_COMPONENTS

     = {
         topLeft: { x: -1, y: -1 },
         topCenter: { x: 0, y: -1 },
         topRight: { x: 1, y: -1 },
         middleLeft: { x: -1, y: 0 },
         middleCenter: { x: 0, y: 0 },
         middleRight: { x: 1, y: 0 },
         bottomLeft: { x: -1, y: 1 },
         bottomCenter: { x: 0, y: 1 },
         bottomRight: { x: 1, y: 1 },
     };

    /**
     * All possible values of {@link Handle}.
     *
     * @ignore
     */
    const HANDLES = [
        ...SCALE_HANDLES,
        'rotator',
        'skewHorizontal',
        'skewVertical',
    ];

    /**
     * The default tolerance for scaling by dragging the bounding-box edges.
     *
     * @ignore
     */
    const DEFAULT_BOX_SCALING_TOLERANCE = 4;

    /**
     * The default tolerance for box-rotation handles.
     *
     * @ignore
     */
    const DEFUALT_BOX_ROTATION_TOLERANCE = 16;

    /**
     * The default snap angles for rotation, in radians.
     *
     * @ignore
     */
    const DEFAULT_ROTATION_SNAPS = [
        Math.PI / 4,
        Math.PI / 2,
        Math.PI * 3 / 4,
        Math.PI,
        0,
        -Math.PI / 4,
        -Math.PI / 2,
        -Math.PI * 3 / 4,
        -Math.PI,
    ];

    /**
     * The default snap tolerance, i.e. the maximum angle b/w the pointer & nearest snap ray for snapping.
     *
     * @ignore
     */
    const DEFAULT_ROTATION_SNAP_TOLERANCE = Math.PI / 90;

    /**
     * The default snap angles for skewing, in radians.
     *
     * @ignore
     */
    const DEFAULT_SKEW_SNAPS = [
        Math.PI / 4,
        -Math.PI / 4,
    ];

    /**
     * The default snap tolerance for skewing.
     *
     * @ignore
     */
    const DEFAULT_SKEW_SNAP_TOLERANCE = Math.PI / 90;

    /**
     * @ignore
     */






    /**
     * The default wireframe style for {@link Transformer}.
     *
     * @ignore
     */
    const DEFAULT_WIREFRAME_STYLE = {
        color: 0x000000,
        thickness: 2,
    };

    /**
     * @public
     */
































































































    // api-extractor-disable-next-line: [ae-forgotten-export]
    const Container_ = display.Container 




    ;

    /**
     * {@code Transformer} provides an interactive interface for editing the transforms in a group. It supports translating,
     * scaling, rotating, and skewing display-objects both through interaction and code.
     *
     * A transformer operates in world-space, and it is best to not position, scale, rotate, or skew one. If you do so, the
     * wireframe itself will not distort (i.e. will adapt _against_ your transforms). However, the wireframe may become
     * thinner/thicker and the handles will scale & rotate. For example, setting `transformer.scale.set(2)` will make the handles
     * twice as big, but will not scale the wireframe (assuming the display-object group itself has not been
     * scaled up).
     *
     * To enable scaling via dragging the edges of the wireframe, set `boxScalingEnabled` to `true`.
     *
     * NOTE: The transformer needs to capture all interaction events that would otherwise go to the display-objects in the
     * group. Hence, it must be placed after them in the scene graph.
     *
     * @extends PIXI.Container
     */
    class Transformer extends Container_
    {
        /** The group of display-objects under transformation. */
        

        /**
         * Specify which bounding boxes should be drawn in the wireframe.
         *
         * "groupOnly" won't show individual bounding boxes. "none" will not render anything visible.
         *
         * @default "all"
         */
        

        /** Set this to enable rotation at the four corners */
        

        /** The thickness of the box rotation area */
        

        /** Set this to enable scaling by dragging at the edges of the bounding box */
        

        /** The padding around the bounding-box to capture dragging on the edges. */
        

        /** This will prevent the wireframe's center from shifting on scaling. */
        

        /** Cursors to use in the transformer */
        

        /**
         * Flags whether the transformer should **not** redraw each frame (good for performance)
         *
         * @default false
         */
        

        /** Set this when you want the transformer to redraw when using {@link Transformer#lazyMode lazyMode}. */
        

        /** Lock aspect ratio when using one of the corner handles. */
        

        /**
         * This is used when the display-object group are rendered through a projection transformation (i.e. are disconnected
         * from the transformer in the scene graph). The transformer project itself into their frame-of-reference using this
         * transform.
         *
         * Specifically, the projection-transform converts points from the group's world space to the transformer's world
         * space. If you are not applying a projection on the transformer itself, this means it is the group's
         * world-to-screen transformation.
         */
        

        /** The angles at which rotation should snap. */
        

        /** The maximum angular difference for snapping rotation. */
        

        /** The distance of skewing handles from the group's center. */
        

        /** The angles at which both the horizontal & vertical skew handles should snap. */
        

        /**
         * The maximum angular difference for snapping skew handles.
         */
        

        /**
         * The root object in your scene in which objects can move.
         *
         * {@code Transformer} will subscribe to this object for `pointermove` events, if provided. This
         * should be used when:
         *
         * * {@link InteractionManager.moveWhenInside moveWhenInside} is enabled on the interaction plugin.
         * * {@link EventBoundary.moveOnAll moveOnAll} is not turned off when using the new {@link EventSystem}.
         *
         * Otherwise, the transformer will receive **not** `pointermove` events when the user drags fast enough that
         * the cursor leaves the transformer's bounds.
         *
         * The stage must be fully interactive in the area you want objects to move. Generally, this is the
         * whole canvas:
         *
         * ```ts
         * stage.interactive = true;
         * stage.hitArea = renderer.screen;// or pass custom rect for the canvas dimensions
         * ```
         */
        

        /**
         * This will enable translation on dragging the transformer. By default, it is turned on.
         *
         * @default true
         */
        

        /**
         * This will reset the rotation angle after the user finishes rotating a group with more than one display-object.
         *
         * @default true
         */
        

        /** The last calculated bounds of the whole group being transformed */
        

        /** Object mapping handle-names to the handle display-objects. */
        

        /**
         * Positions of the various handles
         *
         * @internal
         * @ignore
         */
        

        /** Draws the bounding boxes */
        

        /** @see Transformer#enabledHandles */
        

        /** @see Transformer#rotateEnabled */
        

        /** @see Transformer#scaleEnabled */
        

        /** @see Transformer#skewEnabled */
        

        /** The horizontal skew value. Rotating the group by 𝜽 will also change this value by 𝜽. */
        

        /** The vertical skew value. Rotating the group by 𝜽 will also change this value by 𝜽. */
        

        /** The currently grabbed handle. This can be used to get the type of transformation. */
        

        /** The current type of transform being applied by the user. */
        

        /** The style applied on transformer handles */
        

        /** The wireframe style applied on the transformer */
        

        
        
        
        

        /* eslint-disable max-len */
        /**
         * | Handle                | Type                     | Notes |
         * | --------------------- | ------------------------ | ----- |
         * | rotator               | Rotate                   | |
         * | boxRotateTopLeft      | Rotate                   | Invisible |
         * | boxRotateTopRight     | Rotate                   | Invisible |
         * | boxRotateBottomLeft   | Rotate                   | Invisible |
         * | boxRotateBottomRight  | Rotate                   | Invisible |
         * | topLeft               | Scale                    | |
         * | topCenter             | Scale                    | |
         * | topRight              | Scale                    | |
         * | middleLeft            | Scale                    | |
         * | middleCenter          | Scale                    | This cannot be enabled!                                             |
         * | middleRight           | Scale                    | |
         * | bottomLeft            | Scale                    | |
         * | bottomCenter          | Scale                    | |
         * | bottomRight           | Scale                    | |
         * | skewHorizontal        | Skew                     | Applies vertical shear. Handle segment is horizontal at skew.y = 0! |
         * | skewVertical          | Skew                     | Applied horizontal shear. Handle segment is vertical at skew.x = 0! |
         */
        constructor(options = {})
        {
        /* eslint-enable max-len */
            super();Transformer.prototype.__init.call(this);Transformer.prototype.__init2.call(this);Transformer.prototype.__init3.call(this);Transformer.prototype.__init4.call(this);Transformer.prototype.__init5.call(this);;

            this.interactive = true;
            this.cursors = Object.assign({ default: 'move' }, options.cursors);
            this.cursor = this.cursors.default;

            this.boundingBoxes = options.boundingBoxes || 'all';
            this.group = options.group || [];
            this.boxRotationTolerance = options.boxRotationTolerance || DEFUALT_BOX_ROTATION_TOLERANCE;
            this.boxScalingTolerance = options.boxScalingTolerance || DEFAULT_BOX_SCALING_TOLERANCE;

            this.centeredScaling = !!options.centeredScaling;
            this.projectionTransform = new math.Matrix();

            this.lockAspectRatio = options.lockAspectRatio === true;

            this.rotationSnaps = options.rotationSnaps || DEFAULT_ROTATION_SNAPS;
            this.rotationSnapTolerance = options.rotationSnapTolerance !== undefined
                ? options.rotationSnapTolerance
                : DEFAULT_ROTATION_SNAP_TOLERANCE;

            this.skewRadius = options.skewRadius || 64;
            this.skewSnaps = options.skewSnaps || DEFAULT_SKEW_SNAPS;

            this.skewSnapTolerance = options.skewSnapTolerance !== undefined
                ? options.skewSnapTolerance
                : DEFAULT_SKEW_SNAP_TOLERANCE;

            this.boxRotationEnabled = options.boxRotationEnabled === true;
            this.boxScalingEnabled = options.boxScalingEnabled === true;
            this._rotateEnabled = options.rotateEnabled !== false;
            this._scaleEnabled = options.scaleEnabled !== false;
            this._skewEnabled = options.skewEnabled === true;

            this.translateEnabled = options.translateEnabled !== false;
            this.transientGroupTilt = options.transientGroupTilt !== undefined ? options.transientGroupTilt : true;

            this.wireframe = this.addChild(new TransformerWireframe(this));
            this.wireframe.cursor = 'none';

            this.stage = options.stage || null;

            this._skewX = 0;
            this._skewY = 0;

            this._transformType = 'none';
            this._wireframeStyle = Object.assign({}, DEFAULT_WIREFRAME_STYLE, options.wireframeStyle || {});

            const HandleConstructor = options.handleConstructor || TransformerHandle;
            const handleStyle = options.handleStyle || {};

            this._handleStyle = handleStyle;

            // Initialize transformer handles
            const rotatorHandles = {
                rotator: this.addChild(
                    new HandleConstructor(
                        this,
                        'rotator',
                        handleStyle,
                        (pointerPosition) =>
                        {
                            // The origin is the rotator handle's position, yes.
                            this.rotateGroup('rotator', pointerPosition);
                        },
                        this.commitGroup,
                    ),
                ),
            };
            const scaleHandles = SCALE_HANDLES.reduce((scaleHandles, handleKey) =>
            {
                const handle = new HandleConstructor(
                    this,
                    handleKey,
                    handleStyle,
                    null,
                    this.commitGroup,
                    HANDLE_TO_CURSOR[handleKey]);

                handle.onHandleDelta = (pointerPosition) =>
                {
                    // Scale handles can be swapped with each other, i.e. handle.handle can change!
                    this.scaleGroup(handle.handle , pointerPosition);
                };

                handle.visible = this._scaleEnabled;

                scaleHandles[handleKey] = handle;
                this.addChild(scaleHandles[handleKey]);

                return scaleHandles;
            }, {});
            const skewHandles = {
                skewHorizontal: this.addChild(
                    new HandleConstructor(
                        this,
                        'skewHorizontal',
                        handleStyle,
                        (pointerPosition) => { this.skewGroup('skewHorizontal', pointerPosition); },
                        this.commitGroup,
                        'pointer',
                    )),
                skewVertical: this.addChild(
                    new HandleConstructor(
                        this,
                        'skewVertical',
                        handleStyle,
                        (pointerPosition) => { this.skewGroup('skewVertical', pointerPosition); },
                        this.commitGroup,
                        'pointer',
                    )),
            };

            // Scale handles have higher priority
            this.handles = Object.assign({}, scaleHandles, rotatorHandles, skewHandles) ;
            this.handles.middleCenter.visible = false;
            this.handles.skewHorizontal.visible = this._skewEnabled;
            this.handles.skewVertical.visible = this._skewEnabled;

            this.handleAnchors = {
                rotator: new math.Point(),
                boxRotateTopLeft: new math.Point(),
                boxRotateTopRight: new math.Point(),
                boxRotateBottomLeft: new math.Point(),
                boxRotateBottomRight: new math.Point(),
                topLeft: new math.Point(),
                topCenter: new math.Point(),
                topRight: new math.Point(),
                middleLeft: new math.Point(),
                middleCenter: new math.Point(),
                middleRight: new math.Point(),
                bottomLeft: new math.Point(),
                bottomCenter: new math.Point(),
                bottomRight: new math.Point(),
                skewHorizontal: new math.Point(),
                skewVertical: new math.Point(),
            };

            // Update groupBounds immediately. This is because mouse events can propagate before the next animation frame.
            this.groupBounds = new bounds.OrientedBounds();
            this.updateGroupBounds();

            // Pointer events
            this._pointerDown = false;
            this._pointerDragging = false;
            this._pointerPosition = new math.Point();
            this._pointerMoveTarget = null;

            this.onPointerDown = this.onPointerDown.bind(this);
            this.onPointerMove = this.onPointerMove.bind(this);
            this.onPointerUp = this.onPointerUp.bind(this);
            this.addEventListener('pointerdown', this.onPointerDown);
            this.addEventListener('pointerup', this.onPointerUp);
            this.addEventListener('pointerupoutside', this.onPointerUp);
        }

        /** The list of enabled handles, if applied manually. */
        get enabledHandles()
        {
            return this._enabledHandles;
        }
        set enabledHandles(value)
        {
            if (!this._enabledHandles && !value)
            {
                return;
            }

            this._enabledHandles = value;

            HANDLES.forEach((handleKey) => { this.handles[handleKey].visible = false; });

            if (value)
            {
                value.forEach((handleKey) => { this.handles[handleKey].visible = true; });
            }
            else
            {
                this.handles.rotator.visible = this._rotateEnabled;
                this.handles.skewHorizontal.visible = this._skewEnabled;
                this.handles.skewVertical.visible = this._skewEnabled;

                SCALE_HANDLES.forEach((handleKey) =>
                {
                    if (handleKey === 'middleCenter') return;

                    this.handles[handleKey].visible = this._scaleEnabled;
                });
            }
        }

        /** The currently applied handle style. If you have edited the transformer handles directly, this may be inaccurate. */
        get handleStyle()
        {
            return this._handleStyle;
        }
        set handleStyle(value)
        {
            const handles = this.handles;

            for (const handleKey in handles)
            {
                (handles[handleKey] ).style = value;
            }

            this._handleStyle = value;
        }

        /** This will enable the rotate handles. */
        get rotateEnabled()
        {
            return this._rotateEnabled;
        }
        set rotateEnabled(value)
        {
            if (this._rotateEnabled !== value)
            {
                this._rotateEnabled = value;

                if (this._enabledHandles)
                {
                    return;
                }

                this.handles.rotator.visible = value;
            }
        }

        /** This will enable the scale handles. */
        get scaleEnabled()
        {
            return this._scaleEnabled;
        }
        set scaleEnabled(value)
        {
            if (this._scaleEnabled !== value)
            {
                this._scaleEnabled = value;

                if (this._enabledHandles)
                {
                    return;
                }

                SCALE_HANDLES.forEach((handleKey) =>
                {
                    if (handleKey === 'middleCenter')
                    {
                        return;
                    }

                    this.handles[handleKey].visible = value;
                });
            }
        }

        /** This will enable the skew handles. */
        get skewEnabled()
        {
            return this._skewEnabled;
        }
        set skewEnabled(value)
        {
            if (this._skewEnabled !== value)
            {
                this._skewEnabled = value;

                if (this._enabledHandles)
                {
                    return;
                }

                this.handles.skewHorizontal.visible = value;
                this.handles.skewVertical.visible = value;
            }
        }

        /**
         * This is the type of transformation being applied by the user on the group. It can be inaccurate if you call one of
         * `translateGroup`, `scaleGroup`, `rotateGroup`, `skewGroup` without calling `commitGroup` afterwards.
         *
         * @readonly
         */
        get transformType()
        {
            return this._transformType;
        }

        /** The currently applied wireframe style. */
        get wireframeStyle()
        {
            return this._wireframeStyle;
        }
        set wireframeStyle(value)
        {
            this._wireframeStyle = Object.assign({}, DEFAULT_WIREFRAME_STYLE, value);
        }

        /**
         * @param forceUpdate - forces a recalculation of the group bounds
         * @returns the oriented bounding box of the wireframe
         */
        getGroupBounds(forceUpdate = false)
        {
            if (forceUpdate)
            {
                this.updateGroupBounds();
            }

            return this.groupBounds;
        }

        /**
         * This will translate the group by {@code delta} in their world-space.
         *
         * NOTE: There is no handle that provides translation. The user drags the transformer directly.
         *
         * @param delta
         */
        __init() {this.translateGroup = (delta) =>
        {
            this._transformHandle = null;
            this._transformType = 'translate';

            // Translation matrix
            const matrix = tempMatrix$3
                .identity()
                .translate(delta.x, delta.y);

            this.prependTransform(matrix);
        };}

        /**
         * This will rotate the group such that the handle will come to {@code pointerPosition}.
         *
         * @param handle - the rotator handle was dragged
         * @param pointerPosition - the new pointer position, in screen space
         */
        __init2() {this.rotateGroup = (handle, pointerPosition) =>
        {
            this._transformHandle = handle;
            this._transformType = 'rotate';

            const bounds = this.groupBounds;
            const handlePosition = this.worldTransform.apply(this.handleAnchors[handle], tempPoint$1);

            this.projectionTransform.applyInverse(handlePosition, handlePosition);
            pointerPosition = this.projectionTransform.applyInverse(pointerPosition, tempPointer);

            // Center of rotation - does not change in transformation
            const rOrigin = bounds.center;

            // Original tilt
            const orgAngle = Math.atan2(handlePosition.y - rOrigin.y, handlePosition.x - rOrigin.x);
            // Final tilt
            const dstAngle = Math.atan2(pointerPosition.y - rOrigin.y, pointerPosition.x - rOrigin.x);
            // The angle by which bounds should be rotated
            let deltaAngle = dstAngle - orgAngle;

            // Snap
            let newRotation = this.groupBounds.rotation + deltaAngle;

            newRotation = this.snapAngle(newRotation, this.rotationSnapTolerance, this.rotationSnaps);
            deltaAngle = newRotation - this.groupBounds.rotation;

            // Rotation matrix
            const matrix = tempMatrix$3
                .identity()
                .translate(-rOrigin.x, -rOrigin.y)
                .rotate(deltaAngle)
                .translate(rOrigin.x, rOrigin.y);

            this.prependTransform(matrix, true);
            this.updateGroupBounds(newRotation);

            // Rotation moves both skew.x & skew.y
            this._skewX += deltaAngle;
            this._skewY += deltaAngle;
        };}

        /**
         * This will scale the group such that the scale handle will come under {@code pointerPosition}.
         *
         * @param handle - the scaling handle that was dragged
         * @param pointerPosition - the new pointer position, in screen space
         */
        __init3() {this.scaleGroup = (handle, pointerPosition) =>
        {
            this._transformHandle = handle;
            this._transformType = 'scale';

            // Directions along x,y axes that will produce positive scaling
            const xDir = SCALE_COMPONENTS[handle].x;
            const yDir = SCALE_COMPONENTS[handle].y;

            const handles = this.handles;
            const bounds = this.groupBounds;
            const angle = bounds.rotation;
            const innerBounds = bounds.innerBounds;

            // Position of handle in the group's world-space
            const handlePosition = this.worldTransform.apply(this.handleAnchors[handle], tempPoint$1);

            this.projectionTransform.applyInverse(handlePosition, handlePosition);
            pointerPosition = this.projectionTransform.applyInverse(pointerPosition, tempPointer);

            // Delta vector in world frame
            const dx = pointerPosition.x - handlePosition.x;
            const dy = pointerPosition.y - handlePosition.y;

            // Unit vector along u-axis (horizontal axis after rotation) of bounds
            const uxvec = (bounds.topRight.x - bounds.topLeft.x) / innerBounds.width;
            const uyvec = (bounds.topRight.y - bounds.topLeft.y) / innerBounds.width;

            // Unit vector along v-axis (vertical axis after rotation) of bounds
            const vxvec = (bounds.bottomLeft.x - bounds.topLeft.x) / innerBounds.height;
            const vyvec = (bounds.bottomLeft.y - bounds.topLeft.y) / innerBounds.height;

            // Delta vector in rotated frame of bounds
            const du = (dx * uxvec) + (dy * uyvec);
            const dv = (dx * vxvec) + (dy * vyvec);

            // Scaling factors along x,y axes
            let sx = 1 + (du * xDir / innerBounds.width);
            let sy = 1 + (dv * yDir / innerBounds.height);

            // Only lock aspect ratio if using a handle that scales along both axes.
            const lockAspectRatio = this.lockAspectRatio && (
                handle === 'topLeft' ||
                handle === 'topRight' ||
                handle === 'bottomLeft' ||
                handle === 'bottomRight'
            );

            if (lockAspectRatio)
            {
                if (sx > sy)
                {
                    sy = sx;
                }
                else
                {
                    sx = sy;
                }
            }

            const matrix = tempMatrix$3.identity();

            // NOTE: Do not apply scaling when sx,sy = 0 to prevent matrices from being degenerate.

            if (xDir !== 0 && sx !== 0)
            {
                // Origin of horizontal scaling - a point which does not move after applying the transform
                // eslint-disable-next-line no-nested-ternary
                const hsOrigin = !this.centeredScaling ? (xDir === 1 ? bounds.topLeft : bounds.topRight) : bounds.center;

                matrix.translate(-hsOrigin.x, -hsOrigin.y)
                    .rotate(-angle)
                    .scale(sx, 1)
                    .rotate(angle)
                    .translate(hsOrigin.x, hsOrigin.y);
            }

            if (yDir !== 0 && sy !== 0)
            {
                // Origin of vertical scaling - a point which does not move after applying the transform
                // eslint-disable-next-line no-nested-ternary
                const vsOrigin = !this.centeredScaling ? (yDir === 1 ? bounds.topLeft : bounds.bottomLeft) : bounds.center;

                matrix.translate(-vsOrigin.x, -vsOrigin.y)
                    .rotate(-angle)
                    .scale(1, sy)
                    .rotate(angle)
                    .translate(vsOrigin.x, vsOrigin.y);
            }

            // Handles flips along x & y axis. Handles are always flipped along the y-axis, however. This is
            // because a negative x-scale adds 180° to the rotation - as a result, the handles are automatically
            // flipped along the x-axis but also the y-axis - and this needs to be reversed (by flipping again).
            //
            // NOTE: When both x & y axes are flipped, then there is no need for swapping b/c they cancel out.
            if ((sy < 0 || sx < 0) && !(sy < 0 && sx < 0))
            {
                switch (handle)
                {
                    case 'topLeft':
                    case 'bottomLeft':
                        this.swapHandles(handles.topLeft, handles.bottomLeft);
                        break;
                    case 'topCenter':
                    case 'bottomCenter':
                        this.swapHandles(handles.topCenter, handles.bottomCenter);
                        break;
                    case 'topRight':
                    case 'bottomRight':
                        this.swapHandles(handles.topRight, handles.bottomRight);
                        break;
                }
            }

            this.prependTransform(matrix);
        };}

        /**
         * This will skew the group such that the skew handle would move to the {@code pointerPosition}.
         *
         * @param handle
         * @param pointerPosition - pointer position, in screen space
         */
        __init4() {this.skewGroup = (handle, pointerPosition) =>
        {
            this._transformHandle = handle;
            this._transformType = 'skew';

            const bounds = this.groupBounds;

            // Destination point
            const dst = tempPoint$1.copyFrom(pointerPosition);

            this.projectionTransform.applyInverse(dst, dst);

            // Center of skew (same as center of rotation!)
            const sOrigin = bounds.center;

            // Skew matrix
            const matrix = tempMatrix$3.identity()
                .translate(-sOrigin.x, -sOrigin.y);
            let rotation = this.groupBounds.rotation;

            if (handle === 'skewHorizontal')
            {
                const oldSkew = this._skewX;

                // Calculate new skew
                this._skewX = Math.atan2(dst.y - sOrigin.y, dst.x - sOrigin.x);
                this._skewX = this.snapAngle(this._skewX, this.skewSnapTolerance, this.skewSnaps);

                // Skew by new skew.x
                matrix.prepend(createVerticalSkew(-oldSkew));
                matrix.prepend(createVerticalSkew(this._skewX));
            }
            else // skewVertical
            {
                const oldSkew = this._skewY;

                // Calculate new skew
                const newSkew = Math.atan2(dst.y - sOrigin.y, dst.x - sOrigin.x) - (Math.PI / 2);

                this._skewY = newSkew;
                this._skewY = this.snapAngle(this._skewY, this.skewSnapTolerance, this.skewSnaps);

                // HINT: skewY is applied negatively b/c y-axis is flipped
                matrix.prepend(createHorizontalSkew(oldSkew));
                matrix.prepend(createHorizontalSkew(-this._skewY));

                rotation -= this._skewY - oldSkew;
            }

            matrix.translate(sOrigin.x, sOrigin.y);

            this.prependTransform(matrix, true);
            this.updateGroupBounds(rotation);
        };}

        /**
         * This is called after the user finishes dragging a handle. If {@link this.transientGroupTilt} is enabled, it will
         * reset the rotation of this group (if more than one display-object is grouped).
         */
        __init5() {this.commitGroup = () =>
        {
            this._transformHandle = null;
            this._transformType = 'none';

            if (this.transientGroupTilt !== false && this.group.length > 1)
            {
                this.updateGroupBounds(0);
            }

            this.emit('transformcommit');
        };}

        /**
         * This will update the transformer's geometry and render it to the canvas.
         *
         * @override
         * @param renderer
         */
        render(renderer)
        {
            if (this.renderable && this.visible && (!this.lazyMode || this.lazyDirty))
            {
                this.draw();
            }

            super.render(renderer);
        }

        /** Recalculates the transformer's geometry. This is called on each render. */
         draw()
        {
            const targets = this.group;
            const { color, thickness } = this._wireframeStyle;

            // Updates occur right here!
            this.wireframe.clear();

            if (this.boundingBoxes !== 'none')
            {
                this.wireframe.lineStyle(thickness, color);
            }

            if (this.translateEnabled)
            {
                this.wireframe.beginFill(0xffffff, 1e-4);
            }

            for (let i = 0, j = targets.length; i < j && this.boundingBoxes === 'all'; i++)
            {
                this.wireframe.drawBounds(Transformer.calculateOrientedBounds(targets[i], tempBounds));
            }

            // groupBounds may change on each render-loop b/c of any ongoing animation
            const groupBounds = targets.length !== 1
                ? Transformer.calculateGroupOrientedBounds(targets, this.groupBounds.rotation, tempBounds, true)
                : Transformer.calculateOrientedBounds(targets[0], tempBounds);// Auto-detect rotation

            // Redraw skeleton and position handles
            this.wireframe.drawBounds(groupBounds);

            this.drawHandles(groupBounds);

            // Update cached groupBounds
            this.groupBounds.copyFrom(groupBounds);

            if (this.boxRotationEnabled)
            {
                this.wireframe.closePath()
                    .beginFill(0xffffff, 1e-4)
                    .lineStyle();
                this.wireframe.drawBoxRotationTolerance();
            }

            if (this.boxScalingEnabled)
            {
                this.wireframe
                    .closePath()
                    .beginFill(0xfff0ff, 1e-4)
                    .lineStyle();
                this.wireframe.drawBoxScalingTolerance(groupBounds);
            }

            this.lazyDirty = false;
        }

        /**
         * Draw the handles and any remaining parts of the wireframe.
         *
         * @param groupBounds
         */
         drawHandles(groupBounds)
        {
            const handles = this.handles;
            const handleAnchors = this.handleAnchors;
            const {
                topLeft: worldTopLeft,
                topRight: worldTopRight,
                bottomLeft: worldBottomLeft,
                bottomRight: worldBottomRight,
                center: worldCenter,
            } = groupBounds;

            const [topLeft, topRight, bottomLeft, bottomRight] = tempHull$1;
            const center = tempPoint$1;

            this.projectToLocal(worldTopLeft, topLeft);
            this.projectToLocal(worldTopRight, topRight);
            this.projectToLocal(worldBottomLeft, bottomLeft);
            this.projectToLocal(worldBottomRight, bottomRight);
            this.projectToLocal(worldCenter, center);

            handleAnchors.topLeft.copyFrom(topLeft);
            handleAnchors.topCenter.set((topLeft.x + topRight.x) / 2, (topLeft.y + topRight.y) / 2);
            handleAnchors.topRight.copyFrom(topRight);
            handleAnchors.middleLeft.set((topLeft.x + bottomLeft.x) / 2, (topLeft.y + bottomLeft.y) / 2);
            handleAnchors.middleCenter.set((topLeft.x + bottomRight.x) / 2, (topLeft.y + bottomRight.y) / 2);
            handleAnchors.middleRight.set((topRight.x + bottomRight.x) / 2, (topRight.y + bottomRight.y) / 2);
            handleAnchors.bottomLeft.copyFrom(bottomLeft);
            handleAnchors.bottomCenter.set((bottomLeft.x + bottomRight.x) / 2, (bottomLeft.y + bottomRight.y) / 2);
            handleAnchors.bottomRight.copyFrom(bottomRight);

            if (this.boxRotationEnabled)
            {
                handleAnchors.boxRotateTopLeft.copyFrom(handleAnchors.topLeft);
                handleAnchors.boxRotateTopRight.copyFrom(handleAnchors.topRight);
                handleAnchors.boxRotateBottomLeft.copyFrom(handleAnchors.bottomLeft);
                handleAnchors.boxRotateBottomRight.copyFrom(handleAnchors.bottomRight);
            }

            if (this._rotateEnabled)
            {
                // Midpoint from topLeft to topRight
                const bx = (topLeft.x + topRight.x) / 2;
                const by = (topLeft.y + topRight.y) / 2;

                // Vector perpendicular to <bx,by>.
                let px = -(topLeft.y - topRight.y);
                let py = (topLeft.x - topRight.x);

                // Normalize <px,py> to 32 units.
                const pl = Math.sqrt((px * px) + (py * py));

                px *= 32 / pl;
                py *= 32 / pl;

                handles.rotator.position.x = bx + px;
                handles.rotator.position.y = by + py;

                this.wireframe.moveTo(bx, by)
                    .lineTo(handles.rotator.position.x, handles.rotator.position.y);

                this.handleAnchors.rotator.copyFrom(handles.rotator.position);
            }

            if (this._skewEnabled)
            {
                const cx = center.x;
                const cy = center.y;

                // Transform center into screen space
                this.worldTransform.apply(center, center);

                // Calculate skew handle positions in screen space, and then transform back into local-space. This ensures that
                // the handles appear at skewRadius distance, regardless of the projection.
                handleAnchors.skewHorizontal.set(
                    center.x + (Math.cos(this._skewX) * this.skewRadius),
                    center.y + (Math.sin(this._skewX) * this.skewRadius));
                handleAnchors.skewVertical.set( // HINT: Slope = skew.y + Math.PI / 2
                    center.x + (-Math.sin(this._skewY) * this.skewRadius),
                    center.y + (Math.cos(this._skewY) * this.skewRadius));
                this.worldTransform.applyInverse(handleAnchors.skewHorizontal, handleAnchors.skewHorizontal);
                this.worldTransform.applyInverse(handleAnchors.skewVertical, handleAnchors.skewVertical);

                // Restore center to local-space
                center.set(cx, cy);

                this.wireframe
                    .beginFill(this.wireframeStyle.color)
                    .drawCircle(center.x, center.y, this.wireframeStyle.thickness * 2)
                    .endFill();
                this.wireframe
                    .moveTo(center.x, center.y)
                    .lineTo(handles.skewHorizontal.x, handles.skewHorizontal.y)
                    .moveTo(center.x, center.y)
                    .lineTo(handles.skewVertical.x, handles.skewVertical.y);
            }

            // Update transforms
            for (const handleName in handles)
            {
                let rotation = this.groupBounds.rotation;

                if (handleName === 'skewHorizontal')
                {
                    rotation = this._skewX;
                }
                else if (handleName === 'skewVertical')
                {
                    rotation = this._skewY;
                }

                const handle = handles[handleName];

                handle.rotation = rotation;
                handle.position.copyFrom(handleAnchors[handleName]);
                handle.getBounds(false, tempRect);
            }
        }

        /** Called on the `pointerdown` event. You must call the super implementation. */
         onPointerDown(e)
        {
            this._pointerDown = true;
            this._pointerDragging = false;

            e.stopPropagation();

            if (this._pointerMoveTarget)
            {
                this._pointerMoveTarget.removeEventListener('globalpointermove', this.onPointerMove);
                this._pointerMoveTarget = null;
            }

            this._pointerMoveTarget = (this.stage || this) ;
            this._pointerMoveTarget.addEventListener('globalpointermove', this.onPointerMove);
        }

        /** Called on the `pointermove` event. You must call the super implementation. */
         onPointerMove(e)
        {
            const lastPointerPosition = this._pointerPosition;
            const currentPointerPosition = pointPool$1.allocate().copyFrom(e.data.global);
            const hoveredHandle = this.wireframe.hitHandleType(
                this.groupBounds,
                this.projectionTransform,
                currentPointerPosition);

            if (!this._pointerDown)
            {
                this.setCursorFromHoveredHandle(hoveredHandle);
            }
            else
            {
                const cx = currentPointerPosition.x;
                const cy = currentPointerPosition.y;

                // Translate group by difference
                if (this._pointerDragging)
                {
                    switch (this._transformHandle)
                    {
                        case 'boxRotateTopLeft':
                        case 'boxRotateTopRight':
                        case 'boxRotateBottomLeft':
                        case 'boxRotateBottomRight':
                            this.rotateGroup(this._transformHandle, currentPointerPosition);
                            break;
                        case 'topCenter':
                        case 'middleLeft':
                        case 'middleRight':
                        case 'bottomCenter':
                            this.scaleGroup(this._transformHandle, currentPointerPosition);
                            break;
                        default:
                        {
                            if (this.translateEnabled)
                            {
                                const [worldOrigin, worldDestination, worldDelta] = tempHull$1;

                                // HINT: The pointer has moved from lastPointerPosition to currentPointerPosition in the
                                // transformer's world space. However, we want to translate the display-object's in their
                                // world space; to do this, we project (0,0) and the delta into their world-space, and take
                                // the difference.
                                worldOrigin.set(0, 0);
                                worldDestination.set(
                                    currentPointerPosition.x - lastPointerPosition.x,
                                    currentPointerPosition.y - lastPointerPosition.y);
                                this.projectionTransform.applyInverse(worldOrigin, worldOrigin);
                                this.projectionTransform.applyInverse(worldDestination, worldDestination);

                                worldDelta.set(worldDestination.x - worldOrigin.x, worldDestination.y - worldOrigin.y);

                                this.translateGroup(worldDelta);
                            }
                        }
                    }
                }
                else
                {
                    this._transformHandle = this.wireframe.hitHandleType(
                        this.groupBounds,
                        this.projectionTransform,
                        currentPointerPosition);
                    this.setCursorFromHoveredHandle(hoveredHandle);
                }

                this._pointerPosition.x = cx;
                this._pointerPosition.y = cy;
                this._pointerDragging = true;

                e.stopPropagation();
            }

            pointPool$1.release(currentPointerPosition);
        }

        /** Called on the `pointerup` and `pointerupoutside` events. You must call the super implementation. */
         onPointerUp(e)
        {
            this._pointerDragging = false;
            this._pointerDown = false;

            this.commitGroup();
            e.stopPropagation();

            if (this._pointerMoveTarget)
            {
                this._pointerMoveTarget.removeEventListener('globalpointermove', this.onPointerMove);
                this._pointerMoveTarget = null;
            }
        }

        /**
         * Applies the given transformation matrix {@code delta} to all the display-objects in the group.
         *
         * @param delta - transformation matrix
         * @param skipUpdate - whether to skip updating the group-bounds after applying the transform
         */
         prependTransform(delta, skipUpdate = false)
        {
            const group = this.group;

            for (let i = 0, j = group.length; i < j; i++)
            {
                multiplyTransform(group[i], delta, false);
            }

            emitMatrix.copyFrom(delta);

            if (!skipUpdate)
            {
                this.updateGroupBounds();
            }

            this.emit('transformchange', emitMatrix);
        }

        /**
         * Recalculates {@code this.groupBounds} at the same angle.
         *
         * @param rotation - override the group's rotation
         */
         updateGroupBounds(rotation = this.groupBounds.rotation)
        {
            Transformer.calculateGroupOrientedBounds(this.group, rotation, this.groupBounds);
            this.drawHandles(this.groupBounds);

            this.lazyDirty = true;
        }

        /**
         * Snaps the given {@code angle} to one of the snapping angles, if possible.
         *
         * @param angle - the input angle
         * @param snapTolerance - the maximum difference b/w the given angle & a snapping angle
         * @param snaps - the snapping angles
         * @returns the snapped angle
         */
         snapAngle(angle, snapTolerance, snaps)
        {
            angle = angle % (Math.PI * 2);

            if (!snaps || snaps.length === 1 || !snapTolerance)
            {
                return angle;
            }

            for (let i = 0, j = snaps.length; i < j; i++)
            {
                if (Math.abs(angle - snaps[i]) <= snapTolerance)
                {
                    return snaps[i];
                }
            }

            return angle;
        }

        /**
         * Swap the handles represented by the two {@code TransformerHandle} instances.
         *
         * @param handle0
         * @param handle1
         */
         swapHandles(handle0, handle1)
        {
            const key0 = handle0.handle;
            const key1 = handle1.handle;
            const cursor0 = handle0.cursor;
            const cursor1 = handle1.cursor;
            const x0 = handle0.x;
            const x1 = handle1.x;
            const y0 = handle0.y;
            const y1 = handle1.y;

            handle0.handle = key1;
            handle1.handle = key0;
            handle0.position.set(x1, y1);
            handle1.position.set(x0, y0);
            handle0.cursor = cursor1;
            handle1.cursor = cursor0;

            this.handles[key0] = handle1;
            this.handles[key1] = handle0;

            if (this._transformHandle === key0)
            {
                this._transformHandle = key1;
            }
            else if (this._transformHandle === key1)
            {
                this._transformHandle = key0;
            }
        }

        /** Set cursor from {@code this.cursors} based on the handle hovered currently. */
         setCursorFromHoveredHandle(hoveredHandle)
        {
            if (hoveredHandle && hoveredHandle.startsWith('boxRotate'))
            {
                this.cursor = this.cursors.boxRotate || this.cursors.default;
            }
            else if (hoveredHandle)
            {
                switch (hoveredHandle)
                {
                    case 'topCenter':
                        this.cursor = this.cursors.boxScaleTop || this.cursors.default;
                        break;
                    case 'middleLeft':
                        this.cursor = this.cursors.boxScaleLeft || this.cursors.default;
                        break;
                    case 'middleRight':
                        this.cursor = this.cursors.boxScaleRight || this.cursors.default;
                        break;
                    case 'bottomCenter':
                        this.cursor = this.cursors.boxScaleBottom || this.cursors.default;
                        break;
                }
            }
            else
            {
                this.cursor = this.cursors.translate || this.cursors.default;
            }
        }

        /**
         * Projects {@code input} from the group's world space into the transformer's local space, and puts the result
         * into {@code output}.
         *
         * @param input
         * @param output
         * @returns the output
         */
        projectToLocal(input, output)
        {
            if (!output)
            {
                output = new math.Point();
            }

            this.projectionTransform.apply(input, output);
            this.worldTransform.applyInverse(output, output);

            return output;
        }

        /**
         * Calculates the positions of the four corners of the display-object. The quadrilateral formed by
         * these points will be the tightest fit around it.
         *
         * @param displayObject - The display object whose corners are to be calculated
         * @param transform - The transform applied on the display-object. By default, this is its world-transform
         * @param corners - Optional array of four points to put the result into
         * @param index - Optional index into "corners"
         * @returns an array of four points holding the positions of the corners
         */
        static calculateTransformedCorners(
            displayObject,
            transform = displayObject.worldTransform,
            corners,
            index = 0,
        )
        {
            const localBounds = displayObject.getLocalBounds();

            // Don't modify transforms
            displayObject.getBounds();

            corners = corners || [new math.Point(), new math.Point(), new math.Point(), new math.Point()];
            corners[index].set(localBounds.x, localBounds.y);
            corners[index + 1].set(localBounds.x + localBounds.width, localBounds.y);
            corners[index + 2].set(localBounds.x + localBounds.width, localBounds.y + localBounds.height);
            corners[index + 3].set(localBounds.x, localBounds.y + localBounds.height);

            transform.apply(corners[index], corners[index]);
            transform.apply(corners[index + 1], corners[index + 1]);
            transform.apply(corners[index + 2], corners[index + 2]);
            transform.apply(corners[index + 3], corners[index + 3]);

            return corners;
        }

        /**
         * Calculates the oriented bounding box of the display-object. This would not bending with any skew
         * applied on the display-object, i.e. it is guaranteed to be rectangular.
         *
         * @param displayObject
         * @param bounds - the bounds instance to set
         */
        static calculateOrientedBounds(displayObject, bounds$1)
        {
            const parent = !displayObject.parent ? displayObject.enableTempParent() : displayObject.parent;

            displayObject.updateTransform();
            displayObject.disableTempParent(parent);

            // Decompose displayObject.worldTransform to get its (world) rotation
            decomposeTransform(tempTransform, displayObject.worldTransform);

            tempTransform.updateLocalTransform();

            const angle = tempTransform.rotation;
            const corners = Transformer.calculateTransformedCorners(displayObject, displayObject.worldTransform, tempCorners);

            // Calculate centroid, which is our center of rotation
            const cx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
            const cy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;

            // Unrotation matrix
            const matrix = tempMatrix$3
                .identity()
                .translate(-cx, -cy)
                .rotate(-tempTransform.rotation)
                .translate(cx, cy);

            // Calculate unrotated corners
            matrix.apply(corners[0], corners[0]);
            matrix.apply(corners[1], corners[1]);
            matrix.apply(corners[2], corners[2]);
            matrix.apply(corners[3], corners[3]);

            bounds$1 = bounds$1 || new bounds.OrientedBounds();
            bounds$1.rotation = angle;
            bounds$1.innerBounds.x = Math.min(corners[0].x, corners[1].x, corners[2].x, corners[3].x);
            bounds$1.innerBounds.y = Math.min(corners[0].y, corners[1].y, corners[2].y, corners[3].y);
            bounds$1.innerBounds.width = Math.max(corners[0].x, corners[1].x, corners[2].x, corners[3].x) - bounds$1.innerBounds.x;
            bounds$1.innerBounds.height = Math.max(corners[0].y, corners[1].y, corners[2].y, corners[3].y) - bounds$1.innerBounds.y;

            return bounds$1;
        }

        /**
         * Calculates the oriented bounding box of a group of display-objects at a specific angle.
         *
         * @param group
         * @param rotation
         * @param bounds
         * @param skipUpdate
         */
        static calculateGroupOrientedBounds(
            group,
            rotation,
            bounds$1,
            skipUpdate = false,
        )
        {
            const groupLength = group.length;
            const frames = pointPool$1.allocateArray(groupLength * 4);// Zero allocations!

            // Calculate display-object frame vertices
            for (let i = 0; i < groupLength; i++)
            {
                const displayObject = group[i];

                // Update worldTransform
                if (!skipUpdate)
                {
                    const parent = !displayObject.parent ? displayObject.enableTempParent() : displayObject.parent;

                    displayObject.updateTransform();
                    displayObject.disableTempParent(parent);
                }

                Transformer.calculateTransformedCorners(displayObject, displayObject.worldTransform, frames, i * 4);
            }

            // Unrotation matrix
            const matrix = tempMatrix$3
                .identity()
                .rotate(-rotation);
            let minX = Number.MAX_VALUE;
            let minY = Number.MAX_VALUE;
            let maxX = -Number.MAX_VALUE;
            let maxY = -Number.MAX_VALUE;

            // Unrotate all frame vertices, calculate minX, minY, maxX, maxY for innerBounds
            for (let i = 0, j = frames.length; i < j; i++)
            {
                const point = frames[i];

                matrix.apply(point, point);

                const x = point.x;
                const y = point.y;

                minX = x < minX ? x : minX;
                minY = y < minY ? y : minY;
                maxX = x > maxX ? x : maxX;
                maxY = y > maxY ? y : maxY;
            }

            pointPool$1.releaseArray(frames);

            bounds$1 = bounds$1 || new bounds.OrientedBounds();
            bounds$1.innerBounds.x = minX;
            bounds$1.innerBounds.y = minY;
            bounds$1.innerBounds.width = maxX - minX;
            bounds$1.innerBounds.height = maxY - minY;
            bounds$1.rotation = rotation;

            matrix.applyInverse(bounds$1.center, tempPoint$1);
            bounds$1.center.copyFrom(tempPoint$1);

            return bounds$1;
        }
    }

    /**
     * This is fired when the transformer modifies the transforms of display-objects.
     *
     * @event Transformer#transformchange
     * @type {Matrix}
     */

    /**
     * This is fired when the user lifts the mouse button after dragging a transformer handle. It can be used
     *
     * @event Transformer#transformcommit
     */

    ;
    ;

    exports.Transformer = Transformer;
    exports.TransformerHandle = TransformerHandle;
    exports.TransformerWireframe = TransformerWireframe;

    Object.defineProperty(exports, '__esModule', { value: true });

})));
if (typeof _pixi_essentials_transformer !== 'undefined') { Object.assign(this.PIXI, _pixi_essentials_transformer); }
//# sourceMappingURL=transformer.js.map
