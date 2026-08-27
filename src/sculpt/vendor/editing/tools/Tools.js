import Enums from '@sculpt-vendor/misc/Enums';
import Brush from '@sculpt-vendor/editing/tools/Brush';
import Inflate from '@sculpt-vendor/editing/tools/Inflate';
import Twist from '@sculpt-vendor/editing/tools/Twist';
import Smooth from '@sculpt-vendor/editing/tools/Smooth';
import Flatten from '@sculpt-vendor/editing/tools/Flatten';
import Pinch from '@sculpt-vendor/editing/tools/Pinch';
import Crease from '@sculpt-vendor/editing/tools/Crease';
import Drag from '@sculpt-vendor/editing/tools/Drag';
import Paint from '@sculpt-vendor/editing/tools/Paint';
import Move from '@sculpt-vendor/editing/tools/Move';
import Masking from '@sculpt-vendor/editing/tools/Masking';
import LocalScale from '@sculpt-vendor/editing/tools/LocalScale';
// BOZZETTO EDIT: Transform (and its Gizmo import chain) is deferred past v1.

var Tools = [];

Tools[Enums.Tools.BRUSH] = Brush;
Tools[Enums.Tools.INFLATE] = Inflate;
Tools[Enums.Tools.TWIST] = Twist;
Tools[Enums.Tools.SMOOTH] = Smooth;
Tools[Enums.Tools.FLATTEN] = Flatten;
Tools[Enums.Tools.PINCH] = Pinch;
Tools[Enums.Tools.CREASE] = Crease;
Tools[Enums.Tools.DRAG] = Drag;
Tools[Enums.Tools.PAINT] = Paint;
Tools[Enums.Tools.MOVE] = Move;
Tools[Enums.Tools.MASKING] = Masking;
Tools[Enums.Tools.LOCALSCALE] = LocalScale;

Tools[Enums.Tools.BRUSH].uiName = 'sculptBrush';
Tools[Enums.Tools.INFLATE].uiName = 'sculptInflate';
Tools[Enums.Tools.TWIST].uiName = 'sculptTwist';
Tools[Enums.Tools.SMOOTH].uiName = 'sculptSmooth';
Tools[Enums.Tools.FLATTEN].uiName = 'sculptFlatten';
Tools[Enums.Tools.PINCH].uiName = 'sculptPinch';
Tools[Enums.Tools.CREASE].uiName = 'sculptCrease';
Tools[Enums.Tools.DRAG].uiName = 'sculptDrag';
Tools[Enums.Tools.PAINT].uiName = 'sculptPaint';
Tools[Enums.Tools.MOVE].uiName = 'sculptMove';
Tools[Enums.Tools.MASKING].uiName = 'sculptMasking';
Tools[Enums.Tools.LOCALSCALE].uiName = 'sculptLocalScale';

export default Tools;
