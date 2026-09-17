import { canOpenPath } from '@/lib/nav';
import type { User } from '@/lib/types';
import type { Release, ReleaseSection } from './types';

export type { Release, ReleaseSection } from './types';

/**
 * Bản MỚI NHẤT đứng đầu. Script `db:announce-release` lấy phần tử đầu tiên,
 * và trang `/releases` bày theo đúng thứ tự này.
 */
export const RELEASES: Release[] = [
  {
    id: '2026-09-18',
    title: 'Cập nhật ngày 18/09/2026',
    summary:
      'Khách có HKD nhận thêm Loa hoặc Bảng mica, cộng với quà chính. Hồ sơ đã chốt quà vẫn dời được ngày hồ sơ tới ngày chốt.',
    sections: [
      {
        title: 'Quà tặng cho khách có HKD',
        items: [
          'Khách có tài khoản HKD nhận Loa hoặc Bảng mica CỘNG với quà chính, không phải chọn một trong hai như trước.',
          'Hộp Tặng quà có hai phần: Quà chính và Quà thêm HKD. Bạn chọn mỗi phần một món, hoặc từ chối, rồi bấm Xác nhận một lần.',
          'Hộp Đổi quà cũng có hai phần. Bạn đổi quà chính, quà thêm, hoặc cả hai trong một lần.',
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
    title: 'Cập nhật ngày 17/09/2026',
    summary: 'Cập nhật ngày 17/09/2026.',
    sections: [
      {
        title: 'Đơn bảo hiểm',
        items: [
          'Ngày kết thúc, mức phí và số tiền bảo hiểm lấy theo gói, không sửa tay. Bạn chỉ chọn ngày bắt đầu, app tự tính ngày kết thúc.',
          'Ô Mức phí không còn hiện ở hộp Tạo đơn, Sửa đơn và Cấp lại.',
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
          'Cách xử lý: Trưởng phòng hoặc Phó phòng mở hộp Sửa khách, dời ngày hồ sơ sang ngày 16. Điểm KPI chuyển sang ngày 16.',
          'Nhân viên không dời được. Bạn nhờ Trưởng phòng hoặc Phó phòng dời.',
          'Hồ sơ đã chốt quà thì không dời được.',
        ],
      },
      {
        title: 'Thể lệ từ ngày 16/09/2026',
        items: [
          'LPB, MBV và BIDV là ngân hàng hạn chế. Mỗi hồ sơ khách chỉ mở được MỘT ngân hàng trong ba ngân hàng này.',
          'Tài khoản CNKD kèm bất kỳ ngân hàng nào đều cộng 1,0 điểm.',
          'Ở hộp Mở tài khoản, bạn bấm nút xem luật để biết ngày đó chọn được ngân hàng nào.',
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
