/* globals document, window */
import React, { PureComponent } from 'react';
import PropTypes from 'prop-types';
import clsx from 'clsx';

// Feature detection
// https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener#Improving_scrolling_performance_with_passive_listeners
let passiveSupported = false;

try {
  window.addEventListener('test', null, Object.defineProperty({}, 'passive', {
    get: () => { passiveSupported = true; return true; },
  }));
} catch (err) {} // eslint-disable-line no-empty

function getClientPos(e) {
  let pageX;
  let pageY;

  if (e.touches) {
    [{ pageX, pageY }] = e.touches;
  } else {
    ({ pageX, pageY } = e);
  }

  return {
    x: pageX,
    y: pageY,
  };
}

function clamp(num, min, max) {
  return Math.min(Math.max(num, min), max);
}

function isCropValid(crop) {
  return crop && crop.width && crop.height && !isNaN(crop.width) && !isNaN(crop.height);
}

function inverseOrd(ord) {
  if (ord === 'n') return 's';
  if (ord === 'ne') return 'sw';
  if (ord === 'e') return 'w';
  if (ord === 'se') return 'nw';
  if (ord === 's') return 'n';
  if (ord === 'sw') return 'ne';
  if (ord === 'w') return 'e';
  if (ord === 'nw') return 'se';
  return ord;
}

function makeAspectCrop(crop, imageWidth, imageHeight) {
  if (isNaN(crop.aspect)) {
    console.warn('`crop.aspect` should be a number in order to make an aspect crop', crop);
    return crop;
  }

  const completeCrop = {
    unit: 'px',
    x: 0,
    y: 0,
    ...crop,
  };

  const isPixels = crop.unit === 'px';
  const imageMaxWidth = isPixels ? imageWidth : 100;
  const imageMaxHeight = isPixels ? imageHeight : 100;

  function scaleWidth(width) {
    if (isPixels) return width;
    return width * imageHeight / imageWidth;
  }

  function scaleHeight(height) {
    if (isPixels) return height;
    return height * imageWidth / imageHeight;
  }

  if (crop.width) {
    completeCrop.height = scaleHeight(completeCrop.width / crop.aspect);
  }

  if (crop.height) {
    completeCrop.width = scaleWidth(completeCrop.height * crop.aspect);
  }

  if (completeCrop.y + completeCrop.height > imageMaxHeight) {
    completeCrop.height = imageMaxHeight - completeCrop.y;
    completeCrop.width = scaleWidth(completeCrop.height * crop.aspect);
  }

  if (completeCrop.x + completeCrop.width > imageMaxWidth) {
    completeCrop.width = imageMaxWidth - completeCrop.x;
    completeCrop.height = scaleHeight(completeCrop.width / crop.aspect);
  }

  return completeCrop;
}

function convertToPercentCrop(crop, imageWidth, imageHeight) {
  if (crop.unit === '%') {
    return crop;
  }

  return {
    unit: '%',
    aspect: crop.aspect,
    x: crop.x / imageWidth * 100,
    y: crop.y / imageHeight * 100,
    width: crop.width / imageWidth * 100,
    height: crop.height / imageHeight * 100,
  };
}

function convertToPixelCrop(crop, imageWidth, imageHeight) {
  if (crop.unit === 'px') {
    return crop;
  }

  return {
    unit: 'px',
    aspect: crop.aspect,
    x: crop.x * imageWidth / 100,
    y: crop.y * imageHeight / 100,
    width: crop.width * imageWidth / 100,
    height: crop.height * imageHeight / 100,
  };
}

function isAspectInvalid(crop, imageWidth, imageHeight) {
  if ((!crop.width && crop.height) || (crop.width && !crop.height)) {
    return true;
  }

  if (crop.unit === 'px') {
    return (
      crop.width / crop.aspect !== crop.height ||
      crop.height * crop.aspect !== crop.width ||
      crop.y + crop.height > imageHeight ||
      crop.x + crop.width > imageWidth
    );
  }

  const cropX = Math.round((imageWidth * (crop.x / 100)));
  const cropY = Math.round((imageHeight * (crop.y / 100)));
  const cropHeight = Math.round((imageHeight * (crop.height / 100)));
  const cropWidth = Math.round((imageWidth * (crop.width / 100)));

  return (
    cropWidth / crop.aspect !== cropHeight ||
    cropHeight * crop.aspect !== cropWidth ||
    cropY + crop.height > imageHeight ||
    cropX + crop.width > imageWidth
  );
}

function resolveCrop(crop, imageWidth, imageHeight) {
  if (crop && crop.aspect && isAspectInvalid(crop, imageWidth, imageHeight)) {
    return makeAspectCrop(crop, imageWidth, imageHeight);
  }

  return crop;
}

function containCrop(prevCrop, crop, imageWidth, imageHeight) {
  const contained = { ...crop };
  const isPixels = crop.unit === 'px';
  const imageMaxWidth = isPixels ? imageWidth : 100;
  const imageMaxHeight = isPixels ? imageHeight : 100;

  // Non-aspects are simple
  if (!crop.aspect) {
    if (crop.x < 0) {
      contained.x = 0;
      contained.width += crop.x;
    } else if ((crop.x + crop.width) > imageMaxWidth) {
      contained.width = (imageMaxWidth - crop.x);
    }

    if ((crop.y + crop.height) > imageMaxHeight) {
      contained.height = (imageMaxHeight - crop.y);
    }

    return contained;
  }

  let adjustedForX = false;

  if (crop.x < 0) {
    contained.x = 0;
    contained.width += crop.x;
    contained.height = contained.width / crop.aspect;
    adjustedForX = true;
  } else if ((crop.x + crop.width) > imageMaxWidth) {
    contained.width = (imageMaxWidth - crop.x);
    contained.height = contained.width / crop.aspect;
    adjustedForX = true;
  }

  // If sizing in up direction we need to pin Y at the point it
  // would be at the boundary.
  if (adjustedForX && prevCrop.y > contained.y) {
    contained.y = crop.y + (crop.height - contained.height);
  }

  let adjustedForY = false;

  if ((contained.y + contained.height) > imageMaxHeight) {
    contained.height = (imageMaxHeight - crop.y);
    contained.width = contained.height * crop.aspect;
    adjustedForY = true;
  }

  // If sizing in left direction we need to pin X at the point it
  // would be at the boundary.
  if (adjustedForY && prevCrop.x > contained.x) {
    contained.x = crop.x + (crop.width - contained.width);
  }

  return contained;
}

class ReactCrop extends PureComponent {
  window = typeof window !== 'undefined' ? window : null

  document = typeof document !== 'undefined' ? document : null

  state = {}

  componentDidMount() {
    if (!this.document) {
      return;
    }

    const options = passiveSupported ? { passive: false } : false;
    const doc = this.getDocument();

    doc.addEventListener('mousemove', this.onDocMouseTouchMove, options);
    doc.addEventListener('touchmove', this.onDocMouseTouchMove, options);

    doc.addEventListener('mouseup', this.onDocMouseTouchEnd, options);
    doc.addEventListener('touchend', this.onDocMouseTouchEnd, options);
    doc.addEventListener('touchcancel', this.onDocMouseTouchEnd, options);
  }

  componentWillUnmount() {
    const doc = this.getDocument();
    doc.removeEventListener('mousemove', this.onDocMouseTouchMove);
    doc.removeEventListener('touchmove', this.onDocMouseTouchMove);
    
    doc.removeEventListener('mouseup', this.onDocMouseTouchEnd);
    doc.removeEventListener('touchend', this.onDocMouseTouchEnd);
    doc.removeEventListener('touchcancel', this.onDocMouseTouchEnd);
  }

  onCropMouseTouchDown = (e) => {
    const { crop, disabled } = this.props;

    if (disabled) {
      return;
    }

    e.preventDefault(); // Stop drag selection.

    const clientPos = getClientPos(e);

    // Focus for detecting keypress.
    this.componentRef.focus({ preventScroll: true });

    const { ord } = e.target.dataset;
    const xInversed = ord === 'nw' || ord === 'w' || ord === 'sw';
    const yInversed = ord === 'nw' || ord === 'n' || ord === 'ne';

    let cropOffset;

    if (crop.aspect) {
      cropOffset = this.getElementOffset(this.cropSelectRef);
    }

    this.evData = {
      clientStartX: clientPos.x,
      clientStartY: clientPos.y,
      cropStartWidth: crop.width,
      cropStartHeight: crop.height,
      cropStartX: xInversed ? (crop.x + crop.width) : crop.x,
      cropStartY: yInversed ? (crop.y + crop.height) : crop.y,
      xInversed,
      yInversed,
      xCrossOver: xInversed,
      yCrossOver: yInversed,
      startXCrossOver: xInversed,
      startYCrossOver: yInversed,
      isResize: e.target.dataset.ord,
      ord,
      cropOffset,
    };

    this.mouseDownOnCrop = true;
    this.setState({ cropIsActive: true });
  }

  onComponentMouseTouchDown = (e) => {
    const {
      crop,
      disabled,
      locked,
      keepSelection,
      onChange,
    } = this.props;

    if (e.target !== this.imageRef) {
      return;
    }

    if (disabled || locked || (keepSelection && isCropValid(crop))) {
      return;
    }

    e.preventDefault(); // Stop drag selection.

    const clientPos = getClientPos(e);

    // Focus for detecting keypress.
    this.componentRef.focus({ preventScroll: true });

    const imageOffset = this.getElementOffset(this.imageRef);
    const isPixels = !(crop && crop.unit !== 'px');
    const x = isPixels ? clientPos.x - imageOffset.left : ((clientPos.x - imageOffset.left) / this.imageRef.width) * 100;
    const y = isPixels ? clientPos.y - imageOffset.top : ((clientPos.y - imageOffset.top) / this.imageRef.height) * 100;

    const nextCrop = {
      unit: crop ? crop.unit : 'px',
      aspect: crop ? crop.aspect : undefined,
      x,
      y,
      width: 0,
      height: 0,
    };

    this.evData = {
      clientStartX: clientPos.x,
      clientStartY: clientPos.y,
      cropStartWidth: nextCrop.width,
      cropStartHeight: nextCrop.height,
      cropStartX: nextCrop.x,
      cropStartY: nextCrop.y,
      xInversed: false,
      yInversed: false,
      xCrossOver: false,
      yCrossOver: false,
      startXCrossOver: false,
      startYCrossOver: false,
      isResize: true,
      ord: 'nw',
    };

    this.mouseDownOnCrop = true;
    onChange(
      convertToPixelCrop(nextCrop, this.imageRef.width, this.imageRef.height),
      convertToPercentCrop(nextCrop, this.imageRef.width, this.imageRef.height),
    );
    this.setState({ cropIsActive: true, newCropIsBeingDrawn: true });
  }

  onDocMouseTouchMove = (e) => {
    const {
      crop,
      disabled,
      onChange,
      onDragStart,
    } = this.props;

    if (disabled) {
      return;
    }

    if (!this.mouseDownOnCrop) {
      return;
    }

    e.preventDefault(); // Stop drag selection.

    if (!this.dragStarted) {
      this.dragStarted = true;
      onDragStart(e);
    }

    const { evData } = this;
    const clientPos = getClientPos(e);

    if (evData.isResize && crop.aspect && evData.cropOffset) {
      clientPos.y = this.straightenYPath(clientPos.x);
    }

    evData.xDiff = clientPos.x - evData.clientStartX;
    evData.xDiffPc = (evData.xDiff / this.imageRef.width) * 100;
    evData.yDiff = clientPos.y - evData.clientStartY;
    evData.yDiffPc = (evData.yDiff / this.imageRef.height) * 100;

    let nextCrop;

    if (evData.isResize) {
      nextCrop = this.resizeCrop();
    } else {
      nextCrop = this.dragCrop();
    }

    if (nextCrop !== crop) {
      onChange(
        convertToPixelCrop(nextCrop, this.imageRef.width, this.imageRef.height),
        convertToPercentCrop(nextCrop, this.imageRef.width, this.imageRef.height),
      );
    }
  }

  onComponentKeyDown = (e) => {
    const {
      crop,
      disabled,
      onChange,
      onComplete,
    } = this.props;

    if (disabled) {
      return;
    }

    const keyCode = e.which;
    let nudged = false;

    if (!isCropValid(crop)) {
      return;
    }

    const nextCrop = this.makeNewCrop();

    if (keyCode === ReactCrop.arrowKey.left) {
      nextCrop.x -= ReactCrop.nudgeStep;
      nudged = true;
    } else if (keyCode === ReactCrop.arrowKey.right) {
      nextCrop.x += ReactCrop.nudgeStep;
      nudged = true;
    } else if (keyCode === ReactCrop.arrowKey.up) {
      nextCrop.y -= ReactCrop.nudgeStep;
      nudged = true;
    } else if (keyCode === ReactCrop.arrowKey.down) {
      nextCrop.y += ReactCrop.nudgeStep;
      nudged = true;
    }

    if (nudged) {
      e.preventDefault(); // Stop drag selection.

      if (nextCrop.unit === 'px') {
        nextCrop.x = clamp(nextCrop.x, 0, this.imageRef.width - nextCrop.width);
        nextCrop.y = clamp(nextCrop.y, 0, this.imageRef.height - nextCrop.height);
      } else {
        nextCrop.x = clamp(nextCrop.x, 0, 100);
        nextCrop.y = clamp(nextCrop.y, 0, 100);
      }

      const pixelCrop = convertToPixelCrop(nextCrop, this.imageRef.width, this.imageRef.height);
      const percentCrop = convertToPercentCrop(nextCrop, this.imageRef.width, this.imageRef.height);
      onChange(pixelCrop, percentCrop);
      onComplete(pixelCrop, percentCrop);
    }
  }

  onDocMouseTouchEnd = (e) => {
    const {
      crop,
      disabled,
      onComplete,
      onDragEnd,
    } = this.props;

    if (disabled) {
      return;
    }

    if (this.mouseDownOnCrop) {
      this.mouseDownOnCrop = false;
      this.dragStarted = false;
      onDragEnd(e);
      onComplete(
        convertToPixelCrop(crop, this.imageRef.width, this.imageRef.height),
        convertToPercentCrop(crop, this.imageRef.width, this.imageRef.height),
      );
      this.setState({ cropIsActive: false, newCropIsBeingDrawn: false });
    }
  }

  onImageLoad(image) {
    const {
      onComplete,
      onChange,
      onImageLoaded,
    } = this.props;

    const crop = this.makeNewCrop();
    const resolvedCrop = resolveCrop(crop, image.width, image.height);

    // Return false from onImageLoaded if you set the crop with setState in there as otherwise
    // the subsequent onChange + onComplete will not have your updated crop.
    const res = onImageLoaded(image);

    if (res !== false) {
      const pixelCrop = convertToPixelCrop(resolvedCrop, image.width, image.height);
      const percentCrop = convertToPercentCrop(resolvedCrop, image.width, image.height);
      onChange(pixelCrop, percentCrop);
      onComplete(pixelCrop, percentCrop);
    }
  }

  getDocument() {
    return this.document || document || {};
  }

  getWindow() {
    return this.window || window || {};
  }

  getDocumentOffset() {
    const {clientTop:top = 0, clientLeft:left = 0} = this.getDocument().documentElement || {};
    return { top, left };
  }

  getWindowOffset() {
    const {pageYOffset:top = 0, pageXOffset:left = 0} = this.getWindow();
    return { top, left };
  }

  getElementOffset(el) {
    const rect = el.getBoundingClientRect();
    const doc = this.getDocumentOffset();
    const win = this.getWindowOffset();

    const top = (rect.top + win.top) - doc.top;
    const left = (rect.left + win.left) - doc.left;

    return { top, left };
  }

  getCropStyle() {
    const crop = this.makeNewCrop();

    return {
      top: `${crop.y}${crop.unit}`,
      left: `${crop.x}${crop.unit}`,
      width: `${crop.width}${crop.unit}`,
      height: `${crop.height}${crop.unit}`,
    };
  }

  getLimits() {
    const {
      crop,
      minWidth,
      maxWidth,
      minHeight,
      maxHeight,
    } = this.props;

    if (crop.unit === 'px') {
      return {
        minWidth,
        maxWidth,
        minHeight,
        maxHeight,
      };
    }

    // Convert (min/max is in pixels since v7).
    return {
      minWidth: minWidth / this.imageRef.width * 100,
      maxWidth: maxWidth / this.imageRef.width * 100,
      minHeight: minHeight / this.imageRef.height * 100,
      maxHeight: maxHeight / this.imageRef.height * 100,
    };
  }

  getNewSize() {
    const { crop } = this.props;
    const { evData } = this;
    const isPixels = crop.unit === 'px';
    const imageWidth = this.imageRef.width;
    const imageHeight = this.imageRef.height;
    const limits = this.getLimits();

    // New width.
    let newWidth = isPixels ? evData.cropStartWidth + evData.xDiff : evData.cropStartWidth + evData.xDiffPc;

    if (evData.xCrossOver) {
      newWidth = Math.abs(newWidth);
    }

    newWidth = clamp(newWidth, limits.minWidth, limits.maxWidth || imageWidth);

    // New height.
    let newHeight;

    if (crop.aspect) {
      newHeight = newWidth / crop.aspect;
    } else {
      newHeight = isPixels ?
        evData.cropStartHeight + evData.yDiff :
        evData.cropStartHeight + evData.yDiffPc;
    }

    if (evData.yCrossOver) {
      // Cap if polarity is inversed and the height fills the y space.
      newHeight = Math.min(Math.abs(newHeight), evData.cropStartY);
    }

    newHeight = clamp(newHeight, limits.minHeight, limits.maxHeight || imageHeight);

    if (crop.aspect) {
      newWidth = clamp(newHeight * crop.aspect, 0, imageWidth);
    }

    return {
      width: newWidth,
      height: newHeight,
    };
  }

  dragCrop() {
    const nextCrop = this.makeNewCrop();
    const { evData } = this;

    if (nextCrop.unit === 'px') {
      nextCrop.x = clamp(evData.cropStartX + evData.xDiff, 0, this.imageRef.width - nextCrop.width);
      nextCrop.y = clamp(evData.cropStartY + evData.yDiff, 0, this.imageRef.height - nextCrop.height);
    } else {
      nextCrop.x = clamp(evData.cropStartX + evData.xDiffPc, 0, 100 - nextCrop.width);
      nextCrop.y = clamp(evData.cropStartY + evData.yDiffPc, 0, 100 - nextCrop.height);
    }

    return nextCrop;
  }

  resizeCrop() {
    const { evData } = this;
    const nextCrop = this.makeNewCrop();
    const { ord } = evData;

    // On the inverse change the diff so it's the same and
    // the same algo applies.
    if (evData.xInversed) {
      evData.xDiff -= evData.cropStartWidth * 2;
      evData.xDiffPc -= evData.cropStartWidth * 2;
    }
    if (evData.yInversed) {
      evData.yDiff -= evData.cropStartHeight * 2;
      evData.yDiffPc -= evData.cropStartHeight * 2;
    }

    // New size.
    const newSize = this.getNewSize();

    // Adjust x/y to give illusion of 'staticness' as width/height is increased
    // when polarity is inversed.
    let newX = evData.cropStartX;
    let newY = evData.cropStartY;

    if (evData.xCrossOver) {
      newX = nextCrop.x + (nextCrop.width - newSize.width);
    }

    if (evData.yCrossOver) {
      // This not only removes the little "shake" when inverting at a diagonal, but for some
      // reason y was way off at fast speeds moving sw->ne with fixed aspect only, I couldn't
      // figure out why.
      if (evData.lastYCrossover === false) {
        newY = nextCrop.y - newSize.height;
      } else {
        newY = nextCrop.y + (nextCrop.height - newSize.height);
      }
    }

    const containedCrop = containCrop(this.props.crop, {
      unit: nextCrop.unit,
      x: newX,
      y: newY,
      width: newSize.width,
      height: newSize.height,
      aspect: nextCrop.aspect,
    }, this.imageRef.width, this.imageRef.height);

    // Apply x/y/width/height changes depending on ordinate (fixed aspect always applies both).
    if (nextCrop.aspect || ReactCrop.xyOrds.indexOf(ord) > -1) {
      nextCrop.x = containedCrop.x;
      nextCrop.y = containedCrop.y;
      nextCrop.width = containedCrop.width;
      nextCrop.height = containedCrop.height;
    } else if (ReactCrop.xOrds.indexOf(ord) > -1) {
      nextCrop.x = containedCrop.x;
      nextCrop.width = containedCrop.width;
    } else if (ReactCrop.yOrds.indexOf(ord) > -1) {
      nextCrop.y = containedCrop.y;
      nextCrop.height = containedCrop.height;
    }

    evData.lastYCrossover = evData.yCrossOver;
    this.crossOverCheck();

    return nextCrop;
  }

  straightenYPath(clientX) {
    const { evData } = this;
    const { ord } = evData;
    const { cropOffset, cropStartWidth, cropStartHeight } = evData;
    let k;
    let d;

    if (ord === 'nw' || ord === 'se') {
      k = cropStartHeight / cropStartWidth;
      d = cropOffset.top - (cropOffset.left * k);
    } else {
      k = -cropStartHeight / cropStartWidth;
      d = cropOffset.top + (cropStartHeight - (cropOffset.left * k));
    }

    return (k * clientX) + d;
  }

  createCropSelection() {
    const { disabled, locked, renderSelectionAddon } = this.props;
    const style = this.getCropStyle();

    return (
      <div
        ref={(n) => { this.cropSelectRef = n; }}
        style={style}
        className="ReactCrop__crop-selection"
        onMouseDown={this.onCropMouseTouchDown}
        onTouchStart={this.onCropMouseTouchDown}
        role="presentation"
      >
        {!disabled && !locked && (
          <div className="ReactCrop__drag-elements">
            <div className="ReactCrop__drag-bar ord-n" data-ord="n" />
            <div className="ReactCrop__drag-bar ord-e" data-ord="e" />
            <div className="ReactCrop__drag-bar ord-s" data-ord="s" />
            <div className="ReactCrop__drag-bar ord-w" data-ord="w" />

            <div className="ReactCrop__drag-handle ord-nw" data-ord="nw" />
            <div className="ReactCrop__drag-handle ord-n" data-ord="n" />
            <div className="ReactCrop__drag-handle ord-ne" data-ord="ne" />
            <div className="ReactCrop__drag-handle ord-e" data-ord="e" />
            <div className="ReactCrop__drag-handle ord-se" data-ord="se" />
            <div className="ReactCrop__drag-handle ord-s" data-ord="s" />
            <div className="ReactCrop__drag-handle ord-sw" data-ord="sw" />
            <div className="ReactCrop__drag-handle ord-w" data-ord="w" />
          </div>
        )}
        {renderSelectionAddon && renderSelectionAddon(this.state)}
      </div>
    );
  }

  makeNewCrop() {
    return {
      ...ReactCrop.defaultCrop,
      ...this.props.crop,
    };
  }

  crossOverCheck() {
    const { evData } = this;
    let xDiffNorm;
    let yDiffNorm;

    if (this.props.crop.unit === 'px') {
      xDiffNorm = evData.xDiff;
      yDiffNorm = evData.yDiff;
    } else {
      xDiffNorm = evData.xDiffPc;
      yDiffNorm = evData.yDiffPc;
    }

    if ((!evData.xCrossOver && -Math.abs(evData.cropStartWidth) - xDiffNorm >= 0) ||
      (evData.xCrossOver && -Math.abs(evData.cropStartWidth) - xDiffNorm <= 0)) {
      evData.xCrossOver = !evData.xCrossOver;
    }

    if ((!evData.yCrossOver && -Math.abs(evData.cropStartHeight) - yDiffNorm >= 0) ||
      (evData.yCrossOver && -Math.abs(evData.cropStartHeight) - yDiffNorm <= 0)) {
      evData.yCrossOver = !evData.yCrossOver;
    }

    const swapXOrd = evData.xCrossOver !== evData.startXCrossOver;
    const swapYOrd = evData.yCrossOver !== evData.startYCrossOver;

    evData.inversedXOrd = swapXOrd ? inverseOrd(evData.ord) : false;
    evData.inversedYOrd = swapYOrd ? inverseOrd(evData.ord) : false;
  }

  render() {
    const {
      children,
      className,
      crossorigin,
      crop,
      disabled,
      locked,
      imageAlt,
      onImageError,
      src,
      style,
      imageStyle,
    } = this.props;
    const { cropIsActive, newCropIsBeingDrawn } = this.state;
    const cropSelection = (isCropValid(crop) && this.imageRef) ? this.createCropSelection() : null;

    const componentClasses = clsx('ReactCrop', className, {
      'ReactCrop--active': cropIsActive,
      'ReactCrop--disabled': disabled,
      'ReactCrop--locked': locked,
      'ReactCrop--new-crop': newCropIsBeingDrawn,
      'ReactCrop--fixed-aspect': crop && crop.aspect,
      // In this case we have to shadow the image, since the box-shadow on the crop won't work.
      'ReactCrop--crop-invisible': crop && cropIsActive && (!crop.width || !crop.height),
    });

    return (
      <div
        ref={(n) => { this.componentRef = n; }}
        className={componentClasses}
        style={style}
        onTouchStart={this.onComponentMouseTouchDown}
        onMouseDown={this.onComponentMouseTouchDown}
        role="presentation"
        tabIndex={1}
        onKeyDown={this.onComponentKeyDown}
      >
        <img
          ref={(n) => { this.imageRef = n; }}
          crossOrigin={crossorigin}
          className="ReactCrop__image"
          style={imageStyle}
          src={src}
          onLoad={e => this.onImageLoad(e.target)}
          onError={onImageError}
          alt={imageAlt}
        />
        {children}
        {cropSelection}
      </div>
    );
  }
}

ReactCrop.xOrds = ['e', 'w'];
ReactCrop.yOrds = ['n', 's'];
ReactCrop.xyOrds = ['nw', 'ne', 'se', 'sw'];

ReactCrop.arrowKey = {
  left: 37,
  up: 38,
  right: 39,
  down: 40,
};

ReactCrop.nudgeStep = 0.2;

ReactCrop.defaultCrop = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  unit: 'px',
};

ReactCrop.propTypes = {
  className: PropTypes.string,
  crossorigin: PropTypes.string,
  children: PropTypes.oneOfType([
    PropTypes.arrayOf(PropTypes.node),
    PropTypes.node,
  ]),
  crop: PropTypes.shape({
    aspect: PropTypes.number,
    x: PropTypes.number,
    y: PropTypes.number,
    width: PropTypes.number,
    height: PropTypes.number,
    unit: PropTypes.oneOf(['px', '%']),
  }),
  disabled: PropTypes.bool,
  locked: PropTypes.bool,
  imageAlt: PropTypes.string,
  imageStyle: PropTypes.shape({}),
  keepSelection: PropTypes.bool,
  minWidth: PropTypes.number,
  minHeight: PropTypes.number,
  maxWidth: PropTypes.number,
  maxHeight: PropTypes.number,
  onChange: PropTypes.func.isRequired,
  onImageError: PropTypes.func,
  onComplete: PropTypes.func,
  onImageLoaded: PropTypes.func,
  onDragStart: PropTypes.func,
  onDragEnd: PropTypes.func,
  src: PropTypes.string.isRequired,
  style: PropTypes.shape({}),
  renderSelectionAddon: PropTypes.func,
};

ReactCrop.defaultProps = {
  className: undefined,
  crop: undefined,
  crossorigin: undefined,
  disabled: false,
  locked: false,
  imageAlt: '',
  maxWidth: undefined,
  maxHeight: undefined,
  minWidth: 0,
  minHeight: 0,
  keepSelection: false,
  onComplete: () => {},
  onImageError: () => {},
  onImageLoaded: () => {},
  onDragStart: () => {},
  onDragEnd: () => {},
  children: undefined,
  style: undefined,
  imageStyle: undefined,
  renderSelectionAddon: undefined,
};

export {
  ReactCrop as default,
  ReactCrop as Component,
  makeAspectCrop,
  containCrop,
};
