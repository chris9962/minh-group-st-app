import { canOpenPath } from '@/lib/nav';
import { can, isFullAccess, scopeFor } from '@/lib/permissions';
import type { User } from '@/lib/types';
import type { Release, ReleaseSection } from './types';

export type { Release, ReleaseSection } from './types';

/**
 * Bản MỚI NHẤT đứng đầu. Script `db:announce-release` lấy phần tử đầu tiên,
 * và trang `/releases` bày theo đúng thứ tự này.
 */
export const RELEASES: Release[] = [
  {
    id: '2026-10-03',
    version: '2.2.0',
    title: 'Cập nhật ngày 03/10/2026',
    summary: 'Có màn VNeID, tài khoản VPa CNKD được tặng thêm Loa, xuất Excel chọn được cột.',
    sections: [
      {
        title: 'Quà thêm VPa CNKD',
        items: [
          'Áp cho hồ sơ khách từ 01/10/2026.',
          'Tài khoản VPa CNKD được tặng thêm Loa.',
          'Khách có thêm tài khoản HKD thì mỗi tài khoản chọn Loa hoặc Bảng mica.',
        ],
      },
      {
        title: 'Tháng đã chốt lương',
        items: ['Không tặng, đổi quà được cho hồ sơ lập trong tháng đã chốt lương.'],
      },
      {
        title: 'Lương tháng 09/2026',
        items: [
          'Phòng không giao chỉ tiêu định hướng thì nhân viên phòng đó không tính chỉ tiêu định hướng.',
          'Phòng Y và Phòng Dự án: chỉ tiêu cá nhân tính đủ số, chỉ tiêu phòng vẫn tính 50%.',
        ],
      },
      {
        title: 'VNeID',
        items: [
          'Có thêm màn VNeID.',
          'Mỗi hồ sơ khách ghi BHYT, ASXH, Chữ ký số, ảnh và ghi chú.',
          'Bảng khách hàng có nút Tích hợp VNeID ở mỗi dòng.',
          'Xuất Excel theo bộ lọc đang xem.',
        ],
        visibleTo: (user) => canOpenPath(user, '/vneid'),
      },
      {
        title: 'Khách hàng',
        items: ['Khách còn hồ sơ chưa chốt quà trong cùng tháng thì không tạo được hồ sơ mới.'],
        visibleTo: (user) => canOpenPath(user, '/customers'),
      },
      {
        title: 'Xuất Excel khách hàng',
        items: [
          'Chọn cột trước khi xuất, lần sau giữ lựa chọn.',
          'File có thêm cột Mã nhân viên.',
          'File có thêm cột Ngân hàng, ví dụ MB, TPB, VPa(HKD).',
          'File bỏ cột Số tài khoản, Điểm, Quà.',
        ],
        visibleTo: (user) => can(user, 'customer', 'export'),
      },
      {
        title: 'Xuất Excel đơn bảo hiểm',
        items: ['Chọn cột trước khi xuất, lần sau giữ lựa chọn.', 'File có thêm cột Mã nhân viên.'],
        visibleTo: (user) => can(user, 'insurance', 'export'),
      },
      {
        title: 'Dịch vụ',
        items: ['Nạp / Rút / Chuyển có ô Ảnh giao dịch, không bắt buộc.', 'Bảng Dịch vụ có cột Ảnh.'],
        visibleTo: (user) => canOpenPath(user, '/services'),
      },
      {
        title: 'Chi tiết nhân viên',
        items: ['Xem tháng cũ thì hiện nhãn Đã chốt lương hoặc Chưa chốt lương.'],
        visibleTo: (user) => canOpenPath(user, '/users'),
      },
    ],
  },
  {
    id: '2026-10-02',
    version: '2.1.0',
    title: 'Cập nhật ngày 02/10/2026',
    summary:
      'Tháng đã chốt lương không sửa được dữ liệu, hệ số loại dịch vụ theo tháng, đơn bảo hiểm có ảnh giấy viết tay.',
    sections: [
      {
        title: 'Tháng đã chốt lương',
        items: [
          'Không ghi, sửa, xoá được lượt dịch vụ của tháng đã chốt lương.',
          'Không mở, sửa, đánh lỗi, xoá được tài khoản ngân hàng của hồ sơ lập trong tháng đã chốt lương.',
          'Hồ sơ khách có tài khoản ngân hàng không dời được ngày hồ sơ vào hoặc ra khỏi tháng đã chốt lương.',
          'Điểm KPI và ngày công của tháng đã chốt lương không đổi.',
        ],
      },
      {
        title: 'Lương Điểm ATM',
        items: ['Chi BTXH: 10 lượt đầu mỗi ngày 0,1 điểm/lượt, từ lượt thứ 11 là 0,05 điểm/lượt.'],
      },
      {
        title: 'Đơn bảo hiểm',
        items: [
          'Đơn hoàn thành có thêm ảnh giấy viết tay.',
          'Người tạo đơn tải ảnh lên. Ai mở được đơn thì xem và tải ảnh về.',
        ],
        visibleTo: (user) => canOpenPath(user, '/insurance'),
      },
      {
        title: 'Loại dịch vụ',
        items: [
          'Chọn tháng để xem và sửa hệ số, giới hạn lượt của tháng đó.',
          'Có thêm ô Hệ số lượt vượt giới hạn ngày.',
          'Tháng đã chốt lương không sửa được hệ số.',
          'Trần lượt đổi tên thành Giới hạn lượt.',
        ],
        visibleTo: (user) => canOpenPath(user, '/settings/service-types'),
      },
      {
        title: 'Chỉ tiêu tháng',
        items: [
          'Có thêm ô Điểm KPI mỗi nhân viên, nhập theo từng tháng.',
          'Bỏ màn Chỉ tiêu KPI.',
        ],
        visibleTo: (user) => canOpenPath(user, '/settings/quota'),
      },
      {
        title: 'Kho mã giới thiệu',
        items: ['Có thêm cột Người tạo.'],
        visibleTo: (user) => canOpenPath(user, '/settings/banks'),
      },
    ],
  },
  {
    id: '2026-10-01',
    version: '2.0.0',
    title: 'Cập nhật ngày 01/10/2026',
    summary:
      'Thể lệ mới từ 01/10/2026, lương tháng 10/2026 đổi phần chỉ tiêu và có thêm cách tính Điểm ATM, số liệu tháng cũ tính theo nhân sự của tháng đó.',
    sections: [
      {
        title: 'Thể lệ từ ngày 01/10/2026',
        items: [
          'Áp cho hồ sơ khách từ 01/10/2026.',
          'VPb chuyển sang nhóm bank khác.',
          'VIB chuyển sang nhóm bank hạn chế.',
          'MSBa được tính vào Combo 1 và Combo 2.',
          'Cấm mở VPa + MB trong Combo 2: 0 điểm, không quà.',
        ],
      },
      {
        title: 'Quà Combo 1 và Combo 2',
        items: [
          'Có VPa: tặng 20k, không tặng BH.',
          'Có MSBa: tặng 50k, không tặng BH.',
          'Có cả VPa và MSBa: tặng 70k, không tặng BH.',
          'Hồ sơ còn lại: tặng 1 năm BH.',
        ],
      },
      {
        title: 'Quà Combo 3',
        items: [
          'Có VPa: tặng 1 năm BH và 20k.',
          'Có MSBa: tặng 1 năm BH và 50k.',
          'Có cả VPa và MSBa: tặng 1 năm BH và 70k.',
          'Hồ sơ còn lại: tặng 2 năm BH.',
          'Phòng Y, Phòng Dự án, kênh Bệnh viện: chỉ hồ sơ tặng 2 năm BH được đổi sang quà vật phẩm.',
        ],
      },
      {
        title: 'Tài khoản HKD',
        items: [
          'Mỗi tài khoản HKD cộng 3,0 điểm và được một món quà thêm.',
          'HKD mở được ở mọi ngân hàng, mỗi ngân hàng một tài khoản HKD.',
          'CNKD và HKD khác ngân hàng được cộng điểm cả hai.',
          'Form Tặng quà, Chọn quà thêm, Đổi quà chọn món cho từng tài khoản HKD.',
        ],
      },
      {
        title: 'Khách chỉ nhận tiền mặt',
        items: ['Hồ sơ khách ghi "Chỉ tiền mặt". Khách này không có lượt tặng quà.'],
        visibleTo: (user) => canOpenPath(user, '/customers'),
      },
      {
        title: 'Lương tạm tính từ tháng 10/2026',
        items: [
          'Trưởng phòng, Phó phòng, Phó giám đốc: thiếu chỉ tiêu HKD bị trừ điểm.',
          'Phòng Y và Phòng Dự án tính đủ chỉ tiêu.',
          'Phòng không giao chỉ tiêu định hướng thì nhân viên phòng đó không tính chỉ tiêu định hướng.',
        ],
      },
      {
        title: 'Lương Điểm ATM từ tháng 10/2026',
        items: [
          'Nhân viên Điểm ATM có cách tính lương riêng.',
          'Chỉ nhân viên Điểm ATM có điểm dịch vụ.',
          'Ngày có lượt dịch vụ là ngày công của nhân viên Điểm ATM.',
          'Mỗi loại dịch vụ có trần lượt mỗi ngày và mỗi tháng. Lượt vượt trần được 0 điểm.',
        ],
      },
      {
        title: 'Lương Trưởng phòng, Phó phòng, Phó giám đốc',
        items: [
          'Trung bình phòng, số nhân viên đạt 100 điểm và số người vượt tính trên nhân viên có điểm trong tháng, kể cả người đã khoá.',
        ],
        visibleTo: (user) =>
          user.role === 'head' ||
          user.role === 'deputy-head' ||
          user.role === 'deputy-director' ||
          canOpenPath(user, '/users'),
      },
      {
        title: 'Số liệu tháng cũ',
        items: [
          'Lương, điểm, ngày công và báo cáo của tháng cũ tính theo phòng, chức vụ, loại hợp đồng của đúng tháng đó.',
          'Chuyển phòng chỉ dời số liệu của tháng đang chuyển.',
        ],
      },
      {
        title: 'Chọn khoảng ngày',
        items: ['Mọi ô chọn khoảng ngày chỉ chọn trong một tháng.'],
      },
      {
        title: 'Màu giao diện',
        items: ['Menu tài khoản có mục Giao diện: chọn màu Cam, Xanh dương, Xanh ngọc, Hồng hoặc Xám than.'],
      },
      {
        title: 'Chỉ tiêu tháng',
        items: [
          'Có thêm chỉ tiêu mỗi nhân viên HĐDV. Lương chưa tính theo chỉ tiêu này.',
          'Xem và nhập được chỉ tiêu của tháng sau.',
        ],
        visibleTo: (user) => canOpenPath(user, '/settings/quota'),
      },
      {
        title: 'Loại dịch vụ',
        items: ['Có thêm ô Trần lượt mỗi ngày và Trần lượt mỗi tháng.'],
        visibleTo: (user) => canOpenPath(user, '/settings/service-types'),
      },
      {
        title: 'Hồ sơ nhân viên',
        items: ['Có ô Cách tính lương: Theo phòng hoặc Điểm ATM.'],
        visibleTo: (user) => isFullAccess(user.permissions),
      },
      {
        title: 'Quyền Dịch vụ',
        items: ['Bộ quyền mặc định của các chức vụ dưới Giám đốc không còn quyền Dịch vụ.'],
        visibleTo: (user) => canOpenPath(user, '/users'),
      },
      {
        title: 'Xuất dữ liệu',
        items: [
          'File Tính điểm tổng có hai cột HKD/CNKD VPa và HKD/CNKD MB.',
          'Cột QUÀ TẶNG BÁO CÁO ghi tiền mặt cả khi chưa tặng quà.',
        ],
        visibleTo: (user) => canOpenPath(user, '/exports'),
      },
      {
        title: 'Báo cáo Ngày công',
        items: ['Chọn được phòng.'],
        // Cùng điều kiện với route xuất Ngày công.
        visibleTo: (user) => scopeFor(user, 'staff', 'export') === 'company',
      },
    ],
  },
  {
    id: '2026-09-29',
    version: '1.7.0',
    title: 'Cập nhật ngày 29/09/2026',
    summary:
      'Giữ mã giới thiệu theo từng loại tài khoản, lương tháng 9/2026 đổi phần chỉ tiêu, nhân viên tự sửa họ tên và số điện thoại.',
    sections: [
      {
        title: 'Giữ mã giới thiệu',
        items: [
          'Mỗi ngân hàng, mỗi người giữ tối đa 2 mã Thường, 1 mã CNKD và 2 mã HKD chưa hoàn tất.',
          'Muốn mở thêm thì hoàn tất hoặc xoá bớt tài khoản đang tạo.',
        ],
        visibleTo: (user) => can(user, 'banking', 'create'),
      },
      {
        title: 'Lương tạm tính tháng 9/2026',
        items: [
          'Phòng Y và Phòng Dự án tính theo 50% chỉ tiêu.',
          'Trưởng phòng, Phó phòng, Phó giám đốc: thiếu chỉ tiêu HKD không bị trừ điểm.',
          'Diễn giải lương luôn hiện dòng chỉ tiêu, kể cả khi 0đ.',
        ],
      },
      {
        title: 'Trang Cá nhân',
        items: ['Tự sửa họ tên và số điện thoại bằng nút Sửa thông tin.'],
      },
      {
        title: 'Lọc tài khoản ngân hàng',
        items: ['Ô lọc Loại TK chọn được nhiều loại cùng lúc.'],
        visibleTo: (user) => canOpenPath(user, '/banking') || canOpenPath(user, '/settings/banks'),
      },
      {
        title: 'Xuất dữ liệu',
        items: ['Thêm báo cáo Ngày công theo tháng.'],
        // Báo cáo chỉ hiện cho người xuất nhân viên toàn công ty, cùng điều kiện với route.
        visibleTo: (user) => scopeFor(user, 'staff', 'export') === 'company',
      },
    ],
  },
  {
    id: '2026-09-28',
    version: '1.6.0',
    title: 'Cập nhật ngày 28/09/2026',
    summary: 'Thể lệ mới từ 28/09/2026: mỗi hồ sơ mở tối đa 2 bank hạn chế, thêm 3 tổ hợp.',
    sections: [
      {
        title: 'Thể lệ từ ngày 28/09/2026',
        items: [
          'Áp cho hồ sơ khách từ 28/09/2026.',
          'Mỗi hồ sơ mở tối đa 2 bank hạn chế.',
          '1 ưu tiên + 1 hạn chế: 0,3 điểm, tặng 1 năm BH.',
          '1 ưu tiên + 2 hạn chế: 0,5 điểm, tặng 2 năm BH.',
          '1 khác + 2 hạn chế: 0,4 điểm, tặng 2 năm BH.',
        ],
      },
      {
        title: 'Xuất dữ liệu',
        items: ['Báo cáo Đơn bảo hiểm huỷ thêm cột Policy number, Số seri, Số GCN.'],
        visibleTo: (user) => canOpenPath(user, '/exports'),
      },
      {
        title: 'Danh mục xã / ấp',
        items: ['Cập nhật lại giao diện.'],
        visibleTo: (user) => canOpenPath(user, '/settings/wards'),
      },
    ],
  },
  {
    id: '2026-09-25',
    version: '1.5.0',
    title: 'Cập nhật ngày 25/09/2026',
    summary:
      'Lương tạm tính từ tháng 9/2026 có thêm phần chỉ tiêu theo QĐ 145, Diễn giải lương gọn hơn. Trang Khách hàng lọc được nhiều ấp cùng lúc.',
    sections: [
      {
        title: 'Chỉ tiêu trong lương tạm tính',
        items: [
          'Từ tháng 9/2026, lương tạm tính có thêm phần chỉ tiêu theo QĐ 145 cho nhân viên HĐLĐ, Trưởng phòng, Phó phòng và Phó giám đốc của các phòng kinh doanh CĐS.',
          'Diễn giải lương hiện số tài khoản đã đạt trên chỉ tiêu, và số điểm được cộng hoặc bị trừ.',
          'Nhân viên HĐDV và HĐTV không có chỉ tiêu. Lương của các bạn tính như cũ.',
        ],
      },
      {
        title: 'Diễn giải lương gọn hơn',
        items: [
          'Mỗi khoản lương hiện trên hai dòng: tên khoản và số tiền ở trên, cách tính ở dưới.',
          'Các số ở đầu Diễn giải lương xếp thành hai cột.',
        ],
      },
      {
        title: 'Tổng quan',
        items: [
          'Bộ chọn kỳ còn Hôm nay, Tháng này và khoảng ngày tự chọn.',
          'Khoảng ngày tự chọn phải nằm trong một tháng.',
        ],
      },
      {
        title: 'Lọc khách hàng',
        items: [
          'Ô lọc Ấp chọn được nhiều ấp cùng lúc.',
          'Ô lọc Tài khoản chọn được nhiều lựa chọn cùng lúc.',
          'Khi bạn chọn khoảng ngày, ô lọc Ấp chỉ hiện ấp có khách lập hồ sơ trong khoảng ngày đó.',
        ],
        visibleTo: (user) => canOpenPath(user, '/customers'),
      },
      {
        title: 'Danh sách tài khoản ngân hàng',
        items: [
          'Ô khoảng ngày lọc theo ngày mở tài khoản, cùng cách với trang chi tiết ngân hàng.',
        ],
        visibleTo: (user) => canOpenPath(user, '/banking'),
      },
      {
        title: 'Hồ sơ Phó giám đốc',
        items: [
          'Bảng Theo phòng có hai cột HKD / chỉ tiêu và Định hướng / chỉ tiêu của tháng.',
          'Ô đạt chỉ tiêu hiện chữ màu xanh.',
        ],
        visibleTo: (user) => user.role === 'deputy-director' || canOpenPath(user, '/users'),
      },
      {
        title: 'Loại hợp đồng của nhân viên',
        items: [
          'Form sửa nhân viên có ô Loại hợp đồng: HĐLĐ, HĐDV, HĐTV.',
          'Trang Nhân sự & KPI có ô lọc Loại hợp đồng.',
        ],
        visibleTo: (user) => canOpenPath(user, '/users'),
      },
      {
        title: 'Cài đặt Chỉ tiêu tháng',
        items: [
          'Mục Cài đặt có màn Chỉ tiêu tháng. Bạn chọn tháng, nhập chỉ tiêu mỗi nhân viên HĐLĐ và chỉ tiêu từng phòng.',
          'Bạn chọn tài khoản nào tính vào tài khoản định hướng và HKD, theo từng ngân hàng và loại tài khoản.',
          'Tháng chưa lưu chỉ tiêu thì lương dùng chỉ tiêu của tháng gần nhất trước đó. Tháng đã chốt lương thì không sửa được.',
        ],
        visibleTo: (user) => canOpenPath(user, '/settings/quota'),
      },
      {
        title: 'Khôi phục tài khoản ngân hàng',
        items: [
          'Trang tài khoản trong Cài đặt ngân hàng: tài khoản đang Lỗi có nút Khôi phục hoàn thành.',
        ],
        visibleTo: (user) => isFullAccess(user.permissions),
      },
    ],
  },
  {
    id: '2026-09-23',
    version: '1.4.0',
    title: 'Cập nhật ngày 23/09/2026',
    summary:
      'Ô lọc Tài khoản ở trang Khách hàng lọc theo số tài khoản. Màn đăng nhập nhắc khi bạn gõ sai mật khẩu nhiều lần.',
    sections: [
      {
        title: 'Lọc khách theo số tài khoản',
        items: [
          'Trang Khách hàng: ô lọc Tài khoản có thêm 1 tài khoản, 2 tài khoản và ≥3 tài khoản.',
        ],
      },
      {
        title: 'Đăng nhập',
        items: [
          'Bạn gõ sai mật khẩu 3 lần liên tiếp thì màn đăng nhập hiện thông báo nhắc.',
          'Sai 5 lần liên tiếp thì tài khoản khoá 15 phút.',
        ],
      },
      {
        title: 'Mở khoá đăng nhập cho nhân viên',
        items: [
          'Hồ sơ nhân viên, tab Tài khoản & quyền: khi người đó đang bị khoá vì sai mật khẩu, nút "Mở khoá đăng nhập" hiện kèm thời gian còn lại.',
          'Bấm nút thì người đó đăng nhập lại được ngay.',
        ],
        visibleTo: (user) => can(user, 'staff', 'update'),
      },
      {
        title: 'Xuất Excel đơn bảo hiểm',
        items: [
          'Trang Bảo hiểm có nút Xuất Excel. File lấy đúng bộ lọc đang xem, có số ấn chỉ và số GCN.',
          'Mỗi lượt xuất tối đa 31 ngày.',
        ],
        visibleTo: (user) => can(user, 'insurance', 'export'),
      },
      {
        title: 'Hồ sơ Phó giám đốc',
        items: ['Thanh Tỉ lệ cài hiện đúng độ dài theo phần trăm. Trước đây thanh 43% gần như trống.'],
        visibleTo: (user) => user.role === 'deputy-director' || canOpenPath(user, '/users'),
      },
    ],
  },
  {
    id: '2026-09-21',
    version: '1.3.0',
    title: 'Cập nhật ngày 21/09/2026',
    summary:
      'App hiện lương tạm tính theo KPI. Giao diện mới: ô tìm nhanh, bộ lọc gọn hơn, thanh đáy điện thoại có đủ việc tạo mới.',
    sections: [
      {
        title: 'Lương tạm tính theo KPI',
        items: [
          'Trang Tổng quan và hồ sơ nhân viên có ô Lương của tháng hiện tại. Số che sẵn, bạn bấm nút con mắt để hiện.',
          'Nút Diễn giải liệt kê từng khoản của tháng.',
          'Lương tạm tính áp cho nhân viên, Trưởng phòng, Phó phòng của các phòng kinh doanh CĐS, và Phó giám đốc. Người ở phòng khác thấy ô Lương là 0đ.',
          'Số này là tạm tính, chưa gồm chỉ tiêu HKD, CASA và tài khoản định hướng.',
        ],
      },
      {
        title: 'Cột Lương ở trang Nhân sự và Phòng ban',
        items: [
          'Trang Nhân sự có cột Lương của từng người. Trang chi tiết phòng ban hiện lương của Trưởng phòng và Phó phòng kèm nút Diễn giải.',
        ],
        visibleTo: (user) => canOpenPath(user, '/users') || canOpenPath(user, '/departments'),
      },
      {
        title: 'Ô tìm nhanh',
        items: [
          'Thanh trên có ô tìm nhanh. Bạn gõ tên khách, số tài khoản, mã giới thiệu hoặc tên nhân viên để mở thẳng bản ghi hoặc màn cần tới.',
        ],
      },
      {
        title: 'Bộ lọc',
        items: [
          'Giao diện mới cho bộ lọc ở mọi màn danh sách, gom vào một nút Lọc, dễ chọn hơn trên điện thoại.',
        ],
      },
      {
        title: 'Tổng quan',
        items: [
          'Bảng xếp hạng đánh dấu ba hạng đầu và có cột Tăng trưởng so với kỳ trước.',
          'Bộ chọn kỳ có thêm 3 tháng, 6 tháng, 12 tháng và khoảng ngày tự chọn.',
        ],
      },
      {
        title: 'Giao diện',
        items: [
          'Trên điện thoại: nút Tạo mới ở thanh đáy có đủ việc bạn được phép tạo, form và thông báo mở từ đáy màn, tiêu đề màn luôn hiện.',
          'Chữ trên app dùng phông Google Sans, rõ hơn trên màn hình điện thoại.',
        ],
      },
      {
        title: 'Cài đặt ngân hàng',
        items: [
          'Cùng một chuỗi mã text nhập được nhiều dòng trong cùng ngân hàng và loại tài khoản, phân biệt bằng Tên hiển thị. Tên hiển thị không được trùng.',
        ],
        visibleTo: (user) => canOpenPath(user, '/settings/banks'),
      },
    ],
  },
  {
    id: '2026-09-18',
    version: '1.2.0',
    title: 'Cập nhật ngày 18/09/2026',
    summary:
      'Khách có HKD nhận thêm Loa hoặc Bảng mica, cộng với quà chính. Hồ sơ đã chốt quà vẫn dời được ngày hồ sơ tới ngày chốt.',
    sections: [
      {
        title: 'Quà tặng cho khách có HKD',
        items: [
          'Khách có tài khoản HKD nhận Loa hoặc Bảng mica CỘNG với quà chính, không phải chọn một trong hai như trước.',
          'Form Tặng quà có hai phần: Quà chính và Quà thêm HKD. Bạn chọn mỗi phần một món, hoặc từ chối, rồi bấm Xác nhận một lần.',
          'Form Đổi quà cũng có hai phần. Bạn đổi quà chính, quà thêm, hoặc cả hai trong một lần.',
          'Hồ sơ khách, danh sách khách và file Excel ghi cả hai món, ví dụ "1 năm BH xe máy + Loa".',
        ],
      },
      {
        title: 'Dời ngày hồ sơ khách',
        items: [
          'Hồ sơ đã chốt quà vẫn dời được ngày hồ sơ, nhưng ngày mới không được sau ngày chốt quà.',
          'Ví dụ: hồ sơ lập ngày 16, phát quà ngày 17. Bạn dời được sang ngày 17, không dời được sang ngày 18.',
        ],
      },
      {
        title: 'Xuất dữ liệu',
        items: ['Báo cáo "Tính điểm tổng, gộp theo khách" có thêm ô lọc Ấp, cùng danh sách với ô Ấp ở trang Khách hàng.'],
        visibleTo: (user) => canOpenPath(user, '/exports'),
      },
      {
        title: 'Kho mã giới thiệu',
        items: ['Bộ lọc, ô tìm và trang đang xem nằm trên đường dẫn. Bạn mở một mã rồi bấm Quay lại thì bảng còn nguyên bộ lọc.'],
        visibleTo: (user) => canOpenPath(user, '/settings/banks'),
      },
      {
        title: 'Bảng và thông báo',
        items: [
          'Kéo bảng sang ngang thì thanh chuyển trang đứng yên, không trôi theo cột.',
          'Thông báo về tài khoản ngân hàng ghi kèm tên khách.',
        ],
      },
    ],
  },
  {
    id: '2026-09-17',
    version: '1.1.0',
    title: 'Cập nhật ngày 17/09/2026',
    summary: 'Cập nhật ngày 17/09/2026.',
    sections: [
      {
        title: 'Đơn bảo hiểm',
        items: [
          'Ngày kết thúc, mức phí và số tiền bảo hiểm lấy theo gói, không sửa tay. Bạn chỉ chọn ngày bắt đầu, app tự tính ngày kết thúc.',
          'Ô Mức phí không còn hiện ở form Tạo đơn, Sửa đơn và Cấp lại.',
          'Nút "Điền theo hồ sơ khách" hỏi trước: mua cho bản thân khách hay người thân. Chọn "Bản thân khách" thì app điền tên, địa chỉ, ngày sinh. Chọn "Người thân" thì bạn tự nhập.',
          'Ngày sinh không nhận ngày sau ngày hiện tại.',
        ],
      },
      {
        title: 'Tên khách và người thụ hưởng',
        items: [
          'Tên tự viết hoa chữ cái đầu mỗi chữ khi lưu. Gõ "nguyen van a" hay "NGUYEN VAN A" đều lưu thành "Nguyen Van A". Khoảng trắng thừa được gộp lại.',
        ],
      },
    ],
  },
  {
    id: '2026-09-16',
    version: '1.0.0',
    title: 'Cập nhật ngày 16/09/2026',
    summary:
      'Tài khoản đang tạo tự xoá lúc 00:00. Trưởng phòng dời được ngày hồ sơ khách để điểm KPI ghi đúng ngày. LPB, MBV, BIDV là ngân hàng hạn chế.',
    sections: [
      {
        title: 'Tài khoản đang tạo tự xoá lúc 00:00',
        items: [
          'Tài khoản đang tạo phải hoàn thành trong ngày. Qua 00:00 hệ thống xoá, bạn phải nhập lại từ đầu.',
          'Thẻ tài khoản đang tạo hiện đếm ngược tới giờ xoá.',
          'Mỗi ngân hàng bạn chỉ giữ được 2 tài khoản đang tạo. Muốn mở thêm thì hoàn thành hoặc xoá bớt.',
        ],
      },
      {
        title: 'Dời ngày hồ sơ khách để điểm KPI ghi đúng ngày',
        items: [
          'Điểm KPI, quà và luật chọn ngân hàng tính theo NGÀY HỒ SƠ của khách, không theo ngày mở tài khoản.',
          'Tình huống: khách lập hồ sơ ngày 15, ngày 16 mới mở tài khoản. Điểm KPI ghi vào ngày 15.',
          'Cách xử lý: Trưởng phòng hoặc Phó phòng mở form Sửa khách, dời ngày hồ sơ sang ngày 16. Điểm KPI chuyển sang ngày 16.',
          'Nhân viên không dời được. Bạn nhờ Trưởng phòng hoặc Phó phòng dời.',
          'Hồ sơ đã chốt quà thì không dời được.',
        ],
      },
      {
        title: 'Thể lệ từ ngày 16/09/2026',
        items: [
          'LPB, MBV và BIDV là ngân hàng hạn chế. Mỗi hồ sơ khách chỉ mở được MỘT ngân hàng trong ba ngân hàng này.',
          'Tài khoản CNKD kèm bất kỳ ngân hàng nào đều cộng 1,0 điểm.',
          'Ở form Mở tài khoản, bạn bấm nút xem luật để biết ngày đó chọn được ngân hàng nào.',
        ],
      },
      {
        title: 'Bảo hiểm',
        items: ['Cấp lại đơn thì đơn mới vẫn đứng tên người tạo đơn cũ.'],
      },
    ],
  },
];

export const releaseById = (id: string): Release | undefined => RELEASES.find((r) => r.id === id);

/** Mục của một bản mà người này ĐƯỢC THẤY. */
export const sectionsFor = (release: Release, user: User | null): ReleaseSection[] =>
  user ? release.sections.filter((s) => !s.visibleTo || s.visibleTo(user)) : [];
