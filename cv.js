/*
Copyright (c) 2011 Juan Mellado

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.
*/

var CV = CV || {};

CV.Image = function (width, height, data) {
          this.width = width || 0;
          this.height = height || 0;
          this.data = data || [];
};

CV.grayscale = function (imageSrc, imageDst) {
          var src = imageSrc.data, dst = imageDst.data, len = src.length,
                    i = 0, j = 0;

          imageDst.width = imageSrc.width;
          imageDst.height = imageSrc.height;
          imageDst.data = [];

          for (; i < len; i += 4) {
                    dst[j++] = (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114 + 0.5) & 0xff;
          }
};

CV.threshold = function (imageSrc, imageDst, threshold) {
          var src = imageSrc.data, dst = imageDst.data, len = src.length, tab = [], i;

          imageDst.width = imageSrc.width;
          imageDst.height = imageSrc.height;
          imageDst.data = [];

          for (i = 0; i < 256; ++i) {
                    tab[i] = i <= threshold ? 0 : 255;
          }
          for (i = 0; i < len; ++i) {
                    dst[i] = tab[src[i]];
          }
};

CV.adaptiveThreshold = function (imageSrc, imageDst, kernelSize, threshold) {
          var src = imageSrc.data, dst = imageDst.data, len = src.length, tab = [], i;

          imageDst.width = imageSrc.width;
          imageDst.height = imageSrc.height;
          imageDst.data = [];

          CV.stackBoxBlur(imageSrc, imageDst, kernelSize);

          for (i = 0; i < 768; ++i) {
                    tab[i] = (i - 255 <= -threshold) ? 255 : 0;
          }
          for (i = 0; i < len; ++i) {
                    dst[i] = tab[src[i] - dst[i] + 255];
          }
};

CV.otsu = function (imageSrc) {
          var src = imageSrc.data, len = imageSrc.width * imageSrc.height,
                    hist = [], threshold = 0, sum = 0, sumB = 0, wB = 0, wF = 0, max = 0,
                    mu, between, i;

          for (i = 0; i < 256; ++i) {
                    hist[i] = 0;
          }
          for (i = 0; i < len; ++i) {
                    hist[src[i]]++;
          }
          for (i = 0; i < 256; ++i) {
                    sum += i * hist[i];
          }
          for (i = 0; i < 256; ++i) {
                    wB += hist[i];
                    if (0 !== wB) {
                              wF = len - wB;
                              if (0 === wF) {
                                        break;
                              }
                              sumB += i * hist[i];
                              mu = (sumB / wB) - ((sum - sumB) / wF);
                              between = wB * wF * mu * mu;
                              if (between > max) {
                                        max = between;
                                        threshold = i;
                              }
                    }
          }
          return threshold;
};

CV.stackBoxBlurMult =
          [1, 171, 205, 293, 57, 373, 79, 137, 241, 27, 391, 357, 41, 19, 283, 265];

CV.stackBoxBlurShift =
          [0, 9, 10, 11, 9, 12, 10, 11, 12, 9, 13, 13, 10, 9, 13, 13];

CV.BlurStack = function () {
          this.color = 0;
          this.next = null;
};

CV.stackBoxBlur = function (imageSrc, imageDst, kernelSize) {
          var src = imageSrc.data, dst = imageDst.data,
                    height = imageSrc.height, width = imageSrc.width,
                    heightMinus1 = height - 1, widthMinus1 = width - 1,
                    size = kernelSize + kernelSize + 1, radius = kernelSize + 1,
                    mult = CV.stackBoxBlurMult[kernelSize],
                    shift = CV.stackBoxBlurShift[kernelSize],
                    stack, stackStart, color, sum, pos, start, p, x, y, i;

          imageDst.width = width;
          imageDst.height = height;
          imageDst.data = [];

          stack = stackStart = new CV.BlurStack();
          for (i = 1; i < size; ++i) {
                    stack = stack.next = new CV.BlurStack();
          }
          stack.next = stackStart;

          pos = 0;

          for (y = 0; y < height; ++y) {
                    sum = radius * src[pos];

                    stack = stackStart;
                    for (i = 0; i < radius; ++i) {
                              stack.color = src[pos];
                              stack = stack.next;
                    }
                    for (i = 1; i < radius; ++i) {
                              stack.color = src[pos + (widthMinus1 < i ? widthMinus1 : i)];
                              sum += stack.color;
                              stack = stack.next;
                    }

                    stack = stackStart;
                    for (x = 0; x < width; ++x) {
                              dst[pos++] = (sum * mult) >>> shift;

                              p = x + radius;
                              p = pos - x + (p < widthMinus1 ? p : widthMinus1);

                              sum -= stack.color - src[p];

                              stack.color = src[p];
                              stack = stack.next;
                    }
          }

          for (x = 0; x < width; ++x) {
                    pos = x;
                    sum = radius * dst[pos];

                    stack = stackStart;
                    for (i = 0; i < radius; ++i) {
                              stack.color = dst[pos];
                              stack = stack.next;
                    }
                    for (i = 1; i < radius; ++i) {
                              stack.color = dst[pos + (heightMinus1 < i ? heightMinus1 : i) * width];
                              sum += stack.color;
                              stack = stack.next;
                    }

                    stack = stackStart;
                    for (y = 0; y < height; ++y) {
                              dst[pos] = (sum * mult) >>> shift;

                              p = y + radius;
                              p = x + (p < heightMinus1 ? p : heightMinus1) * width;

                              sum -= stack.color - dst[p];

                              stack.color = dst[p];
                              stack = stack.next;

                              pos += width;
                    }
          }
};

CV.findContours = function (imageSrc, binary) {
          var width = imageSrc.width, height = imageSrc.height, contours = [],
                    src, deltas, pos, pix, nbd, outer, hole, i, j;

          src = [];
          for (i = 0, j = imageSrc.data.length; i < j; ++i) {
                    src[i] = imageSrc.data[i];
          }

          deltas = CV.neighborhoodDeltas(width + 2);

          pos = width + 3;
          nbd = 1;

          for (i = 0; i < height; ++i, pos += 2) {
                    for (j = 0; j < width; ++j, ++pos) {
                              pix = src[pos];

                              if (0 !== pix) {
                                        outer = hole = false;

                                        if (1 === pix && 0 === src[pos - 1]) {
                                                  outer = true;
                                        } else if (pix >= 1 && 0 === src[pos + 1]) {
                                                  hole = true;
                                        }

                                        if (outer || hole) {
                                                  ++nbd;

                                                  contours.push(CV.borderFollowing(src, pos, nbd, { x: j, y: i }, hole, deltas));
                                        }
                              }
                    }
          }

          return contours;
};

CV.borderFollowing = function (src, pos, nbd, point, hole, deltas) {
          var contour = [], pos1, pos3, pos4, s, s_end, s_prev;

          contour.hole = hole;

          s = s_end = hole ? 0 : 4;
          do {
                    s = (s - 1) & 7;
                    pos1 = pos + deltas[s];
                    if (src[pos1] !== 0) {
                              break;
                    }
          } while (s !== s_end);

          if (s === s_end) {
                    src[pos] = -nbd;
                    contour.push({ x: point.x, y: point.y });
          } else {
                    pos3 = pos;
                    s_prev = s ^ 4;

                    while (true) {
                              s_end = s;

                              do {
                                        pos4 = pos3 + deltas[s];
                                        if (src[pos4] !== 0) {
                                                  break;
                                        }
                                        s = (s + 1) & 7;
                              } while (s !== s_end);

                              if ((s + 1) & 4) {
                                        src[pos3] = -nbd;
                              } else if (src[pos3] === 1) {
                                        src[pos3] = nbd;
                              }

                              contour.push({ x: point.x, y: point.y });

                              if (pos4 === pos && pos3 === pos1) {
                                        break;
                              }

                              pos3 = pos4;
                              s = (s + 4) & 7;

                              point.x += (1 === s || 2 === s || 3 === s ? 1 : 5 === s || 6 === s || 7 === s ? -1 : 0);
                              point.y += (7 === s || 0 === s || 1 === s ? -1 : 3 === s || 4 === s || 5 === s ? 1 : 0);

                              s_prev = (s + 4) & 7;
                    }
          }

          return contour;
};

CV.neighborhoodDeltas = function (width) {
          return [-width - 1, -width, -width + 1, 1, width + 1, width, width - 1, -1];
};

CV.approxPolyDP = function (contour, epsilon) {
          var dominated, dominated_i, p1, p2, px, dist, d_sq, len, i, j, k;

          var slice = [];
          for (i = 0, len = contour.length; i < len; ++i) {
                    slice.push(contour[i]);
          }

          while (true) {
                    dominated_i = -1;
                    dominated = 0;

                    for (i = 0, len = slice.length; i < len; ++i) {
                              p1 = slice[i];
                              p2 = slice[(i + 1) % len];

                              if ((d_sq = CV.distSq(p1, p2)) <= 4) {
                                        continue;
                              }

                              for (j = 2; j < len; ++j) {
                                        k = (i + j) % len;
                                        px = slice[k];
                                        dist = CV.distToSegmentSq(px, p1, p2);
                                        if (dist < epsilon && dist > dominated) {
                                                  dominated_i = k;
                                                  dominated = dist;
                                        }
                              }
                    }

                    if (dominated_i >= 0) {
                              slice.splice(dominated_i, 1);
                    } else {
                              break;
                    }
          }

          return slice;
};

CV.distSq = function (p1, p2) {
          var dx = p1.x - p2.x, dy = p1.y - p2.y;
          return dx * dx + dy * dy;
};

CV.distToSegmentSq = function (p, p1, p2) {
          var dx = p2.x - p1.x, dy = p2.y - p1.y, d = dx * dx + dy * dy,
                    t = d ? ((p.x - p1.x) * dx + (p.y - p1.y) * dy) / d : 0;
          if (t < 0) {
                    dx = p.x - p1.x; dy = p.y - p1.y;
          } else if (t > 1) {
                    dx = p.x - p2.x; dy = p.y - p2.y;
          } else {
                    dx = p.x - (p1.x + t * dx); dy = p.y - (p1.y + t * dy);
          }
          return dx * dx + dy * dy;
};

CV.isContourConvex = function (contour) {
          var orientation = 0, convex = true,
                    len = contour.length, i = 0, j = 0,
                    cur_pt, prev_pt, dxdy0, dydx0, dx0, dy0, dx, dy;

          prev_pt = contour[len - 1];
          cur_pt = contour[0];

          dx0 = cur_pt.x - prev_pt.x;
          dy0 = cur_pt.y - prev_pt.y;

          for (; i < len; ++i) {
                    j = (i + 1) % len;

                    prev_pt = cur_pt;
                    cur_pt = contour[j];

                    dx = cur_pt.x - prev_pt.x;
                    dy = cur_pt.y - prev_pt.y;
                    dxdy0 = dx * dy0;
                    dydx0 = dy * dx0;

                    orientation |= dxdy0 > dydx0 ? 1 : (dxdy0 < dydx0 ? 2 : 0);
                    if (3 === orientation) {
                              convex = false;
                              break;
                    }

                    dx0 = dx;
                    dy0 = dy;
          }

          return convex;
};

CV.perimeter = function (poly) {
          var len = poly.length, i = 0, j = len - 1,
                    p = 0.0, dx, dy;

          for (; i < len; j = i++) {
                    dx = poly[i].x - poly[j].x;
                    dy = poly[i].y - poly[j].y;
                    p += Math.sqrt(dx * dx + dy * dy);
          }

          return p;
};

CV.minEdgeLength = function (poly) {
          var len = poly.length, i = 0, j = len - 1,
                    min = Infinity, d, dx, dy;

          for (; i < len; j = i++) {
                    dx = poly[i].x - poly[j].x;
                    dy = poly[i].y - poly[j].y;
                    d = dx * dx + dy * dy;
                    if (d < min) {
                              min = d;
                    }
          }

          return Math.sqrt(min);
};

CV.warp = function (imageSrc, imageDst, contour, warpSize) {
          var src = imageSrc.data, dst = imageDst.data,
                    width = imageSrc.width, height = imageSrc.height,
                    pos = 0, sx1, sx2, dx1, dx2, sy1, sy2, dy1, dy2, p1, p2, p3, p4,
                    m, r, s, t, u, v, w, x, y, i, j;

          imageDst.width = warpSize;
          imageDst.height = warpSize;
          imageDst.data = [];

          sx1 = contour[0].x; sy1 = contour[0].y;
          sx2 = contour[1].x; sy2 = contour[1].y;
          dx1 = contour[3].x; dy1 = contour[3].y;
          dx2 = contour[2].x; dy2 = contour[2].y;

          for (i = 0; i < warpSize; ++i) {
                    r = i / warpSize;
                    s = 1.0 - r;

                    p1 = sx1 * s + dx1 * r;
                    p2 = sy1 * s + dy1 * r;
                    p3 = sx2 * s + dx2 * r;
                    p4 = sy2 * s + dy2 * r;

                    for (j = 0; j < warpSize; ++j) {
                              u = j / warpSize;
                              v = 1.0 - u;

                              x = (p1 * v + p3 * u + 0.5) | 0;
                              y = (p2 * v + p4 * u + 0.5) | 0;

                              dst[pos++] = src[y * width + x];
                    }
          }
};

CV.countNonZero = function (imageSrc, square) {
          var src = imageSrc.data, height = imageSrc.height, width = imageSrc.width,
                    pos = square.x + square.y * width,
                    span = width - square.width, cnt = 0, i, j;

          for (i = 0; i < square.height; ++i) {
                    for (j = 0; j < square.width; ++j) {
                              if (0 !== src[pos++]) {
                                        ++cnt;
                              }
                    }
                    pos += span;
          }

          return cnt;
};
